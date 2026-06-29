import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { StatBucket } from "./api";
import { LevelBadge, StatsChart, StatusBadge, relativeTime } from "./components";

// Dashboard components are pure presentational React (no state/effects), so we
// render them to a static SVG/HTML string via react-dom/server — no jsdom, no
// act(), no new test library. react-dom is already a dependency.
// ponytail: stateful/effectful components (e.g. ReplayPlayer) need a DOM —
// add `// @vitest-environment jsdom` + createRoot there; not required here.

const bucket = (count: number, users: number, at = "2026-06-29T00:00:00.000Z"): StatBucket => ({
  bucket: at,
  count,
  users
});

const countMatches = (html: string, tag: string): number =>
  html.match(new RegExp(`<${tag}\\b`, "g"))?.length ?? 0;

describe("StatsChart", () => {
  test("renders the empty state when there are no buckets", () => {
    const html = renderToStaticMarkup(<StatsChart buckets={[]} />);
    expect(html).toContain("이 구간에 이벤트가 없습니다.");
    expect(html).not.toContain("<svg");
  });

  test("draws one bar per bucket and sums the event total", () => {
    const html = renderToStaticMarkup(
      <StatsChart buckets={[bucket(2, 0), bucket(3, 0), bucket(5, 0)]} />
    );
    expect(countMatches(html, "rect")).toBe(3);
    expect(html).toContain("이벤트 10건");
  });

  test("omits the affected-users overlay when no bucket has users", () => {
    const html = renderToStaticMarkup(
      <StatsChart buckets={[bucket(4, 0), bucket(1, 0)]} />
    );
    expect(html).not.toContain("<polyline");
    expect(countMatches(html, "circle")).toBe(0);
    // "영향 사용자" lives in the always-present aria-label; the footer legend
    // ("빨간 선: …") is the part that must be gated on hasUsers.
    expect(html).not.toContain("빨간 선");
  });

  test("a single bucket with users draws a marker but no line", () => {
    // Regression guard: a polyline needs ≥2 points, so the common single-hour
    // spike must still surface its users via a circle marker.
    const html = renderToStaticMarkup(<StatsChart buckets={[bucket(7, 3)]} />);
    expect(html).not.toContain("<polyline");
    expect(countMatches(html, "circle")).toBe(1);
    expect(html).toContain("빨간 선: 영향 사용자 추세");
  });

  test("multiple buckets with users draw both the line and per-bucket markers", () => {
    const html = renderToStaticMarkup(
      <StatsChart buckets={[bucket(7, 3), bucket(2, 1), bucket(4, 2)]} />
    );
    expect(countMatches(html, "polyline")).toBe(1);
    expect(countMatches(html, "circle")).toBe(3);
    // The line must carry one point per bucket, not a truncated/duplicated set.
    const points = /points="([^"]+)"/.exec(html)?.[1]?.trim().split(" ") ?? [];
    expect(points).toHaveLength(3);
  });
});

describe("relativeTime", () => {
  test("buckets the elapsed time into human-readable Korean units", () => {
    const ago = (ms: number): string => relativeTime(new Date(Date.now() - ms).toISOString());
    expect(ago(3_000)).toBe("방금");
    expect(ago(5_000)).toBe("5초 전"); // boundary: "방금" is seconds < 5
    expect(ago(30_000)).toBe("30초 전");
    expect(ago(60_000)).toBe("1분 전"); // boundary: seconds → minutes
    expect(ago(5 * 60_000)).toBe("5분 전");
    expect(ago(2 * 3_600_000)).toBe("2시간 전");
    expect(ago(3 * 86_400_000)).toBe("3일 전");
  });
});

describe("badges", () => {
  test("render the Korean label and a level/status-scoped class", () => {
    const level = renderToStaticMarkup(<LevelBadge level="error" />);
    expect(level).toContain("level-error");
    expect(level).toContain("오류");
    const status = renderToStaticMarkup(<StatusBadge status="resolved" />);
    expect(status).toContain("status-resolved");
    expect(status).toContain("해결됨");
  });
});
