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

// Strip query/hash and any directory prefix so a frame's URL
// ("https://app.com/assets/index-4f2a.js?v=1") matches an uploaded source map
// keyed by the bare artifact name ("index-4f2a.js").
export const frameBasename = (filename: string | undefined): string | null => {
  if (filename === undefined || filename === "") {
    return null;
  }

  const withoutQuery = filename.split(/[?#]/u, 1)[0] ?? filename;
  const segments = withoutQuery.split(/[/\\]/u);
  const last = segments.at(-1);
  return last !== undefined && last !== "" ? last : null;
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

  let changed = false;
  const result = frames.map((frame): SymbolicatedFrame => {
    const name = frameBasename(frame.filename);
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
