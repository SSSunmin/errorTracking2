#!/usr/bin/env node
// Upload a build's source maps to Mini-Sentry for stack symbolication.
//
// Usage:
//   MINI_SENTRY_TOKEN=<accessToken> node scripts/upload-sourcemaps.mjs \
//     --url http://localhost:3000 \
//     --project <projectId> \
//     --release <release> \
//     --dir packages/dashboard/dist
//
// The access token is read from MINI_SENTRY_TOKEN (preferred — keeps it out of
// the process arg list / shell history) or, as a fallback, from --token.
//
// Scans <dir> recursively for *.map files and POSTs each one (raw bytes) to
// POST /api/projects/:id/releases/:release/sourcemaps?filename=<minified.js>.
// The filename is the artifact the map applies to (the .map name minus ".map"),
// which is what stack frames are matched against at symbolication time.

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key?.startsWith("--") && value !== undefined) {
      args[key.slice(2)] = value;
    }
  }
  return args;
};

const findMaps = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const maps = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      maps.push(...(await findMaps(full)));
    } else if (entry.name.endsWith(".map")) {
      maps.push(full);
    }
  }
  return maps;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const required = ["url", "project", "release", "dir"];
  const missing = required.filter((key) => args[key] === undefined);
  if (missing.length > 0) {
    console.error(`Missing required args: ${missing.map((k) => `--${k}`).join(", ")}`);
    process.exit(1);
  }

  const token = process.env.MINI_SENTRY_TOKEN ?? args.token;
  if (token === undefined) {
    console.error("Set MINI_SENTRY_TOKEN (preferred) or pass --token <accessToken>");
    process.exit(1);
  }

  const maps = await findMaps(args.dir);
  if (maps.length === 0) {
    console.error(`No .map files found under ${args.dir}`);
    process.exit(1);
  }

  let uploaded = 0;
  for (const mapPath of maps) {
    const artifact = basename(mapPath).replace(/\.map$/u, "");
    const body = await readFile(mapPath);
    const endpoint =
      `${args.url.replace(/\/$/u, "")}/api/projects/${encodeURIComponent(args.project)}` +
      `/releases/${encodeURIComponent(args.release)}/sourcemaps` +
      `?filename=${encodeURIComponent(artifact)}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        authorization: `Bearer ${token}`
      },
      body
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`✗ ${artifact}: ${String(response.status)} ${text}`);
      process.exit(1);
    }

    uploaded += 1;
    console.log(`✓ ${artifact}`);
  }

  console.log(`Uploaded ${String(uploaded)} source map(s) for release ${args.release}.`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
