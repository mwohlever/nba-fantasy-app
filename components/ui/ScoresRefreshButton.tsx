"use client";

export default function ScoresRefreshButton({ onRefresh, disabled, isRefreshing, label = "Refresh scores" }: {
  label?: string;
  onRefresh: () => void;
  disabled: boolean;
  isRefreshing: boolean;
}) {
  return <button type="button" className="scores-icon-button" aria-label={label}
    title={label} disabled={disabled} aria-busy={isRefreshing} onClick={onRefresh}>
    <span aria-hidden="true" className={isRefreshing ? "scores-refresh-spin" : undefined}>↻</span>
  </button>;
}
