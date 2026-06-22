import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";

import { Prisma } from "@prisma/client";

import { notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import {
  frameBasename,
  symbolicateFrames,
  type RawFrame,
  type SymbolicatedFrame
} from "./symbolicate.js";

// Async (libuv threadpool) compression so large source maps never block the
// event loop the way gzipSync/gunzipSync would under concurrent traffic.
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface SourceMapSummaryDto {
  filename: string;
  release: string;
  sizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
}

const ensureOwnedProject = async (
  ownerId: string,
  projectId: string
): Promise<void> => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId },
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
  // column small. The bare artifact name is the lookup key at symbolication time.
  const name = frameBasename(filename) ?? filename;
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

// Load every source map for a release, decompressed and keyed by artifact name,
// ready to feed symbolicateFrames. Corrupt rows are skipped (best-effort).
const loadSourceMapsByName = async (
  projectId: string,
  release: string
): Promise<Map<string, string>> => {
  const records = await prisma.sourceMap.findMany({
    where: { projectId, release },
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
    const byName = await loadSourceMapsByName(group.projectId, group.release);
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
