import type { ReactNode } from "react";

import type { IssueLevel, IssueStatus, StatBucket } from "./api";

export const LevelBadge = ({ level }: { level: IssueLevel }): ReactNode => (
  <span className={`badge level-${level}`}>{level}</span>
);

export const StatusBadge = ({ status }: { status: IssueStatus }): ReactNode => (
  <span className={`badge status-${status}`}>{status}</span>
);

export const relativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.round(diff / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${String(seconds)}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `${String(days)}d ago`;
};

export const StatsChart = ({ buckets }: { buckets: StatBucket[] }): ReactNode => {
  if (buckets.length === 0) {
    return <p className="muted">No events in this window.</p>;
  }
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const width = Math.max(buckets.length * 14, 120);
  const height = 80;
  const barWidth = width / buckets.length;
  const total = buckets.reduce((sum, b) => sum + b.count, 0);

  return (
    <div>
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        height={height}
        style={{ width: "100%", maxWidth: width }}
        preserveAspectRatio="none"
        role="img"
        aria-label="event frequency"
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
              fill="#7c6cf0"
            >
              <title>{`${bucket.bucket}: ${String(bucket.count)}`}</title>
            </rect>
          );
        })}
      </svg>
      <p className="muted">{total} events</p>
    </div>
  );
};

export const Spinner = (): ReactNode => <p className="muted">Loading…</p>;
