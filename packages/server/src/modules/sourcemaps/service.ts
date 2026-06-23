import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";

import { Prisma } from "@prisma/client";

import { notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import {
  frameBasename,
  pathSegments,
  symbolicateFrames,
  type RawFrame,
  type SymbolicatedFrame
} from "./symbolicate.js";

// Async (libuv threadpool) compression so large source maps never block the
// event loop the way gzipSync/gunzipSync would under concurrent traffic.
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// Canonicalize the uploaded artifact name into a normalized relative path
// ("./assets//routes/index.js" → "assets/routes/index.js"). Storing the full
// path (not just the basename) lets symbolication match by path suffix and tell
// same-named artifacts in different directories apart. Basename-only uploads are
// unchanged ("index.js" → "index.js"), so existing tooling keeps working.
const canonicalArtifactName = (filename: string): string => {
  const joined = pathSegments(filename).join("/");
  return joined === "" ? filename : joined;
};

export interface SourceMapSummaryDto {
  filename: string;
  release: string;
  sizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
}

// Membership-based access: `ownerId` is the current user id; any project member
// may manage the project's source maps.
const ensureOwnedProject = async (
  ownerId: string,
  projectId: string
): Promise<void> => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, members: { some: { userId: ownerId } } },
    select: { id: true }
  });

  if (!project) {
    throw notFound("Project not found");
  }
};

// Pull the `{ frames: [...] }` shape the SDK stores, tolerating anything else.
export const extractFrames = (stacktrace: unknown): RawFrame[] => {
  if (
    stacktrace !== null &&
    typeof stacktrace === "object" &&
    "frames" in stacktrace
  ) {
    const frames = (stacktrace as { frames: unknown }).frames;
    if (Array.isArray(frames)) {
      return frames as RawFrame[];
    }
  }
  return [];
};

export const uploadSourceMap = async (
  ownerId: string,
  projectId: string,
  release: string,
  filename: string,
  body: Buffer
): Promise<SourceMapSummaryDto> => {
  await ensureOwnedProject(ownerId, projectId);

  // Source maps are JSON text and compress well; store gzipped to keep the BYTEA
  // column small. The normalized artifact path is the lookup key at
  // symbolication time (matched against frame URLs by path suffix).
  const name = canonicalArtifactName(filename);
  const compressed = await gzipAsync(body);
  const data = Uint8Array.from(compressed);

  const record = await prisma.sourceMap.upsert({
    where: {
      projectId_release_filename: { projectId, release, filename: name }
    },
    create: {
      projectId,
      release,
      filename: name,
      data,
      sizeBytes: data.length
    },
    update: {
      data,
      sizeBytes: data.length
    }
  });

  // A re-uploaded map can change how existing events resolve, so drop the cached
  // symbolication for this release; the next read recomputes it lazily.
  await prisma.event.updateMany({
    where: { projectId, release },
    data: { symbolicated: Prisma.DbNull }
  });

  return {
    filename: record.filename,
    release: record.release,
    sizeBytes: record.sizeBytes,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
};

export const listSourceMaps = async (
  ownerId: string,
  projectId: string,
  release: string
): Promise<{ sourceMaps: SourceMapSummaryDto[] }> => {
  await ensureOwnedProject(ownerId, projectId);

  const records = await prisma.sourceMap.findMany({
    where: { projectId, release },
    orderBy: { filename: "asc" },
    select: {
      filename: true,
      release: true,
      sizeBytes: true,
      createdAt: true,
      updatedAt: true
    }
  });

  return {
    sourceMaps: records.map((record) => ({
      filename: record.filename,
      release: record.release,
      sizeBytes: record.sizeBytes,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
    }))
  };
};

// Load the source maps for a release that the given frames actually reference,
// decompressed and keyed by stored artifact path, ready to feed
// symbolicateFrames. Two-phase to bound memory: first read just the filenames
// (cheap), keep only those whose basename appears in a frame, then load the
// heavy gzipped `data` blob for that subset only. Corrupt rows are skipped
// (best-effort). Returns an empty map when nothing is referenced.
const loadSourceMapsByName = async (
  projectId: string,
  release: string,
  neededBasenames: ReadonlySet<string>
): Promise<Map<string, string>> => {
  if (neededBasenames.size === 0) {
    return new Map();
  }

  const names = await prisma.sourceMap.findMany({
    where: { projectId, release },
    select: { filename: true }
  });
  const wanted = names
    .map((record) => record.filename)
    .filter((filename) => {
      const base = frameBasename(filename);
      return base !== null && neededBasenames.has(base);
    });
  if (wanted.length === 0) {
    return new Map();
  }

  const records = await prisma.sourceMap.findMany({
    where: { projectId, release, filename: { in: wanted } },
    select: { filename: true, data: true }
  });

  const byName = new Map<string, string>();
  await Promise.all(
    records.map(async (record) => {
      try {
        const raw = (await gunzipAsync(Buffer.from(record.data))).toString("utf8");
        byName.set(record.filename, raw);
      } catch {
        // Skip unreadable rows; the frame falls through unsymbolicated.
      }
    })
  );
  return byName;
};

// Collect the artifact basenames referenced by a batch of events' frames; only
// these maps need to be loaded for the release.
const referencedBasenames = (
  events: readonly SymbolicatableEvent[]
): Set<string> => {
  const basenames = new Set<string>();
  for (const event of events) {
    for (const frame of extractFrames(event.stacktrace)) {
      const base = frameBasename(frame.filename);
      if (base !== null) {
        basenames.add(base);
      }
    }
  }
  return basenames;
};

// Delete a release's source maps — a single artifact when `filename` is given,
// otherwise the whole release. Re-uploading or removing a map changes how events
// resolve, so drop the cached symbolication for the release on any deletion.
export const deleteSourceMaps = async (
  ownerId: string,
  projectId: string,
  release: string,
  filename?: string
): Promise<{ deleted: number }> => {
  await ensureOwnedProject(ownerId, projectId);

  const where =
    filename !== undefined
      ? { projectId, release, filename: canonicalArtifactName(filename) }
      : { projectId, release };

  const { count } = await prisma.sourceMap.deleteMany({ where });
  if (count > 0) {
    await prisma.event.updateMany({
      where: { projectId, release },
      data: { symbolicated: Prisma.DbNull }
    });
  }
  return { deleted: count };
};

export interface SymbolicationOutcome {
  frames: SymbolicatedFrame[];
  changed: boolean;
}

export interface SymbolicatableEvent {
  id: string;
  projectId: string;
  release: string | null;
  stacktrace: unknown;
}

interface ReleaseGroup {
  projectId: string;
  release: string;
  events: SymbolicatableEvent[];
}

// Symbolicate a batch of events, loading each (project, release)'s source maps
// at most once. Events without a release, frames, or matching maps are omitted
// from the result so the caller keeps the raw stacktrace for them.
export const symbolicateEvents = async (
  events: readonly SymbolicatableEvent[]
): Promise<Map<string, SymbolicationOutcome>> => {
  const groups = new Map<string, ReleaseGroup>();
  for (const event of events) {
    if (event.release === null || event.release === "") {
      continue;
    }
    if (extractFrames(event.stacktrace).length === 0) {
      continue;
    }
    // JSON.stringify of a tuple is a collision-free key for arbitrary strings.
    const key = JSON.stringify([event.projectId, event.release]);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.events.push(event);
    } else {
      groups.set(key, {
        projectId: event.projectId,
        release: event.release,
        events: [event]
      });
    }
  }

  const result = new Map<string, SymbolicationOutcome>();
  for (const group of groups.values()) {
    const byName = await loadSourceMapsByName(
      group.projectId,
      group.release,
      referencedBasenames(group.events)
    );
    if (byName.size === 0) {
      continue;
    }
    for (const event of group.events) {
      result.set(
        event.id,
        symbolicateFrames(extractFrames(event.stacktrace), byName)
      );
    }
  }

  return result;
};
