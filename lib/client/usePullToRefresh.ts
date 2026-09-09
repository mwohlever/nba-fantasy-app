"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { attachPullToRefresh, IDLE_PULL } from "./pullToRefresh";
import type { RefreshOutcome } from "./refreshOutcome";

export function usePullToRefresh(options: {
  targetRef: RefObject<HTMLElement | null>;
  onRefresh: () => Promise<RefreshOutcome>;
  enabled: boolean;
  isRefreshing: boolean;
  scopeKey: string;
}) {
  const latest = useRef(options);
  latest.current = options;
  const [pull, setPull] = useState(IDLE_PULL);
  useEffect(() => {
    setPull(IDLE_PULL);
    const target = options.targetRef.current;
    if (!target || !options.enabled || options.isRefreshing) return;
    return attachPullToRefresh({
      target, document,
      getContext: () => latest.current,
      onChange: setPull,
      onRefresh: () => latest.current.onRefresh(),
    });
  }, [options.targetRef, options.enabled, options.isRefreshing, options.scopeKey]);
  return pull;
}
