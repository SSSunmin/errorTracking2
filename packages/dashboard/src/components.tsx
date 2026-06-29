import type { ReactNode } from "react";

import type { IssueLevel, IssueStatus, StatBucket } from "./api";
import { levelLabels, statusLabels } from "./labels";

export const LevelBadge = ({ level }: { level: IssueLevel }): ReactNode => (
  <span className={`badge level-${level}`}>{levelLabels[level]}</span>
);

export const StatusBadge = ({ status }: { status: IssueStatus }): ReactNode => (
  <span className={`badge status-${status}`}>{statusLabels[status]}</span>
);

export const relativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.round(diff / 1000);
  if (seconds < 5) return "방금";
  if (seconds < 60) return `${String(seconds)}초 전`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}시간 전`;
  const days = Math.round(hours / 24);
  return `${String(days)}일 전`;
};

export const StatsChart = ({ buckets }: { buckets: StatBucket[] }): ReactNode => {
  if (buckets.length === 0) {
    return <p className="muted">이 구간에 이벤트가 없습니다.</p>;
  }
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const maxUsers = Math.max(...buckets.map((b) => b.users), 1);
  const hasUsers = buckets.some((b) => b.users > 0);
  const width = Math.max(buckets.length * 14, 120);
  const height = 80;
  const barWidth = width / buckets.length;
  const total = buckets.reduce((sum, b) => sum + b.count, 0);

  // Affected-users trend, scaled to its own peak so it reads against the
  // event bars even when user counts are far smaller than event counts.
  const userPoints = buckets.map((bucket, index) => ({
    x: index * barWidth + barWidth / 2,
    y: height - Math.round((bucket.users / maxUsers) * (height - 8))
  }));

  return (
    <div>
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        height={height}
        style={{ width: "100%", maxWidth: width }}
        preserveAspectRatio="none"
        role="img"
        aria-label="이벤트 빈도 및 영향 사용자 추세"
      >
        {buckets.map((bucket, index) => {
          const barHeight = Math.max(Math.round((bucket.count / max) * (height - 8)), 0);
          return (
            <rect
              key={index}
              x={index * barWidth + 1}
              y={height - barHeight}
              width={Math.max(barWidth - 2, 1)}
              height={barHeight}
              fill="var(--accent)"
            >
              <title>{`${bucket.bucket}: 이벤트 ${String(bucket.count)}건 · 사용자 ${String(bucket.users)}명`}</title>
            </rect>
          );
        })}
        {/* polyline needs ≥2 points to draw a line; markers keep the single-
            bucket case (events in one hour — the common spike) visible too. */}
        {hasUsers && userPoints.length >= 2 ? (
          <polyline
            points={userPoints.map((p) => `${String(p.x)},${String(p.y)}`).join(" ")}
            fill="none"
            stroke="var(--danger, #e5484d)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {hasUsers
          ? userPoints.map((p, index) => (
              <circle
                key={index}
                cx={p.x}
                cy={p.y}
                r={2}
                fill="var(--danger, #e5484d)"
                vectorEffect="non-scaling-stroke"
              />
            ))
          : null}
      </svg>
      <p className="muted">
        이벤트 {total}건
        {hasUsers ? " · 빨간 선: 영향 사용자 추세" : ""}
      </p>
    </div>
  );
};

export const Spinner = (): ReactNode => <p className="muted">불러오는 중…</p>;
