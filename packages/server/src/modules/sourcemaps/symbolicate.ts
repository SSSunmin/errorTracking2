import {
  originalPositionFor,
  sourceContentFor,
  TraceMap,
  type SourceMapInput
} from "@jridgewell/trace-mapping";

// A single captured stack frame as stored by the SDK (minified positions).
export interface RawFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

// A frame enriched with its original (pre-minification) location. The raw
// fields are preserved so the UI can still show the minified position.
export interface SymbolicatedFrame extends RawFrame {
  originalFilename?: string;
  originalFunction?: string;
  originalLineno?: number;
  originalColno?: number;
  contextLine?: string;
}

export interface SymbolicateResult {
  frames: SymbolicatedFrame[];
  // True when at least one frame was mapped to an original location. Callers use
  // this to decide whether the result is worth caching.
  changed: boolean;
}

// Split a frame URL / artifact path into its path segments, dropping the
// query/hash, a leading scheme+host ("https://app.com"), and empty segments.
// "https://app.com/assets/routes/index.js?v=1" → ["assets", "routes", "index.js"].
export const pathSegments = (filename: string): string[] => {
  const withoutQuery = filename.split(/[?#]/u, 1)[0] ?? filename;
  const withoutScheme = withoutQuery.replace(
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*/u,
    ""
  );
  return withoutScheme.split(/[/\\]/u).filter((segment) => segment !== "");
};

// Strip query/hash and any directory prefix so a frame's URL
// ("https://app.com/assets/index-4f2a.js?v=1") reduces to the bare artifact name
// ("index-4f2a.js"). Used as the storage key fallback and the load-time filter.
export const frameBasename = (filename: string | undefined): string | null => {
  if (filename === undefined || filename === "") {
    return null;
  }

  const last = pathSegments(filename).at(-1);
  return last !== undefined && last !== "" ? last : null;
};

// Pick the stored source map that best matches a frame by path suffix. A stored
// key matches when its path segments are a tail of the frame's segments; the
// longest (most specific) match wins, so "routes/index.js" beats a bare
// "index.js" and never collides with "utils/index.js". A basename-only stored
// key (one segment) still matches any frame ending in that name — preserving the
// previous behavior when uploads carry no directory information.
interface TracerKey {
  name: string;
  segments: string[];
}

const resolveTracerName = (
  frameFilename: string,
  tracerKeys: readonly TracerKey[]
): string | null => {
  const frameSegs = pathSegments(frameFilename);
  if (frameSegs.length === 0) {
    return null;
  }

  let best: string | null = null;
  let bestLen = 0;
  for (const { name, segments } of tracerKeys) {
    if (segments.length === 0 || segments.length > frameSegs.length) {
      continue;
    }
    const offset = frameSegs.length - segments.length;
    const isSuffix = segments.every(
      (segment, index) => segment === frameSegs[offset + index]
    );
    if (isSuffix && segments.length > bestLen) {
      best = name;
      bestLen = segments.length;
    }
  }
  return best;
};

// Build a TraceMap once per source map, tolerating malformed input by treating
// it as "no map" rather than throwing — symbolication is best-effort.
const buildTracers = (
  sourceMapsByName: ReadonlyMap<string, string>
): Map<string, TraceMap> => {
  const tracers = new Map<string, TraceMap>();
  for (const [name, raw] of sourceMapsByName) {
    try {
      const parsed = JSON.parse(raw) as SourceMapInput;
      tracers.set(name, new TraceMap(parsed));
    } catch {
      // Skip unusable maps; affected frames fall through unchanged.
    }
  }
  return tracers;
};

const contextLineFor = (
  tracer: TraceMap,
  source: string | null,
  line: number | null
): string | undefined => {
  if (source === null || line === null) {
    return undefined;
  }

  const content = sourceContentFor(tracer, source);
  if (content === null) {
    return undefined;
  }

  // originalPositionFor reports 1-based lines; source content is 0-indexed.
  const target = content.split("\n")[line - 1];
  if (target === undefined) {
    return undefined;
  }
  // Slice by code points, not UTF-16 units, so a long line is never cut through
  // the middle of a surrogate pair. Grapheme-cluster splitting (emoji modifiers)
  // doesn't matter for a truncated code preview, so code points are sufficient.
  // eslint-disable-next-line @typescript-eslint/no-misused-spread
  return [...target.trim()].slice(0, 240).join("");
};

const symbolicateFrame = (
  frame: RawFrame,
  tracer: TraceMap
): SymbolicatedFrame | null => {
  if (frame.lineno === undefined) {
    return null;
  }

  // Stack frames use 1-based columns; trace-mapping expects 0-based.
  const column = frame.colno !== undefined ? Math.max(frame.colno - 1, 0) : 0;
  const mapped = originalPositionFor(tracer, {
    line: frame.lineno,
    column
  });

  if (mapped.source === null) {
    return null;
  }

  const enriched: SymbolicatedFrame = {
    ...frame,
    originalFilename: mapped.source,
    originalLineno: mapped.line,
    originalColno: mapped.column,
    ...(mapped.name !== null && mapped.name !== ""
      ? { originalFunction: mapped.name }
      : {})
  };

  const context = contextLineFor(tracer, mapped.source, mapped.line);
  if (context !== undefined && context !== "") {
    enriched.contextLine = context;
  }

  return enriched;
};

// Map each frame to its original location using the supplied source maps (keyed
// by minified artifact basename). Frames without a matching/usable map, or that
// don't resolve, are returned unchanged.
export const symbolicateFrames = (
  frames: readonly RawFrame[],
  sourceMapsByName: ReadonlyMap<string, string>
): SymbolicateResult => {
  if (frames.length === 0 || sourceMapsByName.size === 0) {
    return { frames: [...frames], changed: false };
  }

  const tracers = buildTracers(sourceMapsByName);
  if (tracers.size === 0) {
    return { frames: [...frames], changed: false };
  }
  // Pre-split each stored key's path segments once, not per frame.
  const tracerKeys: TracerKey[] = [...tracers.keys()].map((name) => ({
    name,
    segments: pathSegments(name)
  }));

  let changed = false;
  const result = frames.map((frame): SymbolicatedFrame => {
    if (frame.filename === undefined || frame.filename === "") {
      return frame;
    }

    const name = resolveTracerName(frame.filename, tracerKeys);
    if (name === null) {
      return frame;
    }

    const tracer = tracers.get(name);
    if (tracer === undefined) {
      return frame;
    }

    const enriched = symbolicateFrame(frame, tracer);
    if (enriched === null) {
      return frame;
    }

    changed = true;
    return enriched;
  });

  return { frames: result, changed };
};
