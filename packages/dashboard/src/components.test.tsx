import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { StatBucket } from "./api";
import {
  DistributionCard,
  DistributionTable,
  LevelBadge,
  StatsChart,
  StatusBadge,
  relativeTime,
  type DistributionRow
} from "./components";
import { ProjectSparkline } from "./pages/ProjectsPage";

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

describe("ProjectSparkline", () => {
  test("renders the compact empty state when there are no buckets", () => {
    const html = renderToStaticMarkup(<ProjectSparkline buckets={[]} />);
    expect(html).toContain("데이터 없음");
    expect(html).not.toContain("<svg");
  });

  test("draws one marker per bucket and a trend line", () => {
    const html = renderToStaticMarkup(
      <ProjectSparkline
        buckets={[
          { bucket: "2026-06-29T00:00:00.000Z", count: 2 },
          { bucket: "2026-06-29T01:00:00.000Z", count: 4 },
          { bucket: "2026-06-29T02:00:00.000Z", count: 1 }
        ]}
      />
    );
    expect(countMatches(html, "polyline")).toBe(1);
    expect(countMatches(html, "circle")).toBe(3);
    expect(html).toContain("프로젝트 이벤트 추세");
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

describe("DistributionTable", () => {
  const rows: DistributionRow[] = [
    { key: "prod", label: "production", onSelect: () => undefined, values: [10, 2, 5], share: 100 },
    { key: "__none__", label: "(미지정)", muted: true, values: [3, 0, 0], share: 30 }
  ];

  test("renders the label header and metric columns", () => {
    const html = renderToStaticMarkup(
      <DistributionTable labelHeader="배포 환경" columns={["이벤트", "이슈", "영향 사용자"]} rows={rows} />
    );
    expect(html).toContain("배포 환경");
    expect(html).toContain("이벤트");
    expect(html).toContain("영향 사용자");
  });

  test("only the onSelect row is a clickable chip; muted rows are dashed spans", () => {
    const html = renderToStaticMarkup(
      <DistributionTable labelHeader="배포 환경" columns={["이벤트", "이슈", "영향 사용자"]} rows={rows} />
    );
    // Exactly one clickable chip (production); the (미지정) row is a static span.
    expect(countMatches(html, "button")).toBe(1);
    expect(html).toContain("production");
    expect(html).toContain("env-chip none");
    expect(html).toContain("(미지정)");
  });

  test("share bar width tracks each row's share, and zero metrics are muted", () => {
    const html = renderToStaticMarkup(
      <DistributionTable labelHeader="배포 환경" columns={["이벤트", "이슈", "영향 사용자"]} rows={rows} />
    );
    // One share bar per row, on the first metric column.
    expect(countMatches(html, "span")).toBeGreaterThanOrEqual(2);
    expect(html).toContain("width:100%");
    expect(html).toContain("width:30%");
    // The (미지정) row's two zero metrics render with the muted class.
    expect((html.match(/num-zero/g) ?? []).length).toBe(2);
  });
});

describe("DistributionCard", () => {
  const oneRow: DistributionRow[] = [
    { key: "chrome", label: "Chrome", values: [4, 2], share: 100 }
  ];

  test("rows=null shows the spinner; with isError shows an error message", () => {
    const loading = renderToStaticMarkup(
      <DistributionCard title="브라우저별 분포" windowLabel="최근 24시간" labelHeader="브라우저" columns={["이벤트", "영향 사용자"]} rows={null} />
    );
    expect(loading).toContain("불러오는 중");
    expect(loading).not.toContain("<table");

    const errored = renderToStaticMarkup(
      <DistributionCard title="브라우저별 분포" windowLabel="최근 24시간" labelHeader="브라우저" columns={["이벤트", "영향 사용자"]} rows={null} isError />
    );
    expect(errored).toContain("불러오지 못했습니다");
  });

  test("empty rows show the empty text; populated rows render the table", () => {
    const empty = renderToStaticMarkup(
      <DistributionCard title="브라우저별 분포" windowLabel="최근 24시간" labelHeader="브라우저" columns={["이벤트", "영향 사용자"]} rows={[]} emptyText="이 기간에 이벤트가 없습니다." />
    );
    expect(empty).toContain("이 기간에 이벤트가 없습니다.");
    expect(empty).not.toContain("<table");

    const filled = renderToStaticMarkup(
      <DistributionCard title="브라우저별 분포" windowLabel="최근 24시간" labelHeader="브라우저" columns={["이벤트", "영향 사용자"]} rows={oneRow} />
    );
    expect(filled).toContain("env-stats");
    expect(filled).toContain("브라우저별 분포");
    expect(filled).toContain("최근 24시간");
    expect(filled).toContain("Chrome");
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
