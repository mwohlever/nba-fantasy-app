"use client";

import type { PullState } from "@/lib/client/pullToRefresh";

export default function PullToRefreshIndicator({ pull, feedback }: {
  pull: PullState;
  feedback: string;
}) {
  return <div className="scores-refresh-feedback">
    {pull.distance > 0 && <span className="scores-pull-indicator" aria-hidden="true"
      style={{ transform: `translateY(${Math.min(pull.distance / 8, 12)}px)` }}>
      {pull.armed ? "Release to refresh" : "Pull to refresh"}
    </span>}
    <span role="status" aria-live="polite" aria-atomic="true">{feedback}</span>
  </div>;
}
