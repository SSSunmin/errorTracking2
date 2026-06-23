// When set (e.g. https://replay.example.com), replays and snapshots render in an
// iframe served from this separate origin via a postMessage bridge, isolating
// untrusted recordings from the dashboard origin (tokens, DOM, /api). When empty
// — the default, including local dev — they render in-page on the dashboard
// origin behind rrweb's no-allow-scripts sandbox. Trailing slash trimmed so it
// concatenates cleanly with the viewer path.
export const replayOrigin: string = (
  import.meta.env.VITE_REPLAY_ORIGIN ?? ""
).replace(/\/+$/, "");
