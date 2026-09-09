import type { RefreshOutcome } from "./refreshOutcome";

export type PullState = { distance: number; armed: boolean };
export const IDLE_PULL: PullState = { distance: 0, armed: false };

type Options = {
  target: HTMLElement;
  document: Document;
  getContext: () => { enabled: boolean; isRefreshing: boolean; scopeKey: string };
  onChange: (state: PullState) => void;
  onRefresh: () => Promise<RefreshOutcome>;
  threshold?: number;
};

// Explicit exclusions always win, even inside an opted-in standings control.
const EXCLUDED = "[data-pull-refresh-exclude], a, input, select, textarea, summary, [contenteditable], [role='dialog'], [aria-modal='true']";
const SCORES_PULL_START = 'button[data-scores-pull-start="true"]';

/** A document-scrolling gesture, attached only to its opted-in page surface. */
export function attachPullToRefresh(options: Options) {
  const { target, document: doc, getContext, onChange, onRefresh, threshold = 70 } = options;
  let gesture: { x: number; y: number; id: number; scope: string; distance: number; peak: number; fromScoresRow: boolean } | null = null;
  let pending = false;
  let disposed = false;
  const rootStyle = doc.documentElement.style;
  const previous = rootStyle.getPropertyValue("overscroll-behavior-y");
  const priority = rootStyle.getPropertyPriority("overscroll-behavior-y");
  rootStyle.setProperty("overscroll-behavior-y", "contain");

  const reset = () => { gesture = null; if (!disposed) onChange(IDLE_PULL); };
  const atTop = () => (doc.scrollingElement?.scrollTop ?? doc.documentElement.scrollTop) <= 1;
  const allowed = () => {
    const context = getContext();
    return !disposed && context.enabled && !context.isRefreshing && !pending &&
      !doc.querySelector("[aria-modal='true'], [data-pull-refresh-overlay], details[data-pull-refresh-exclude][open]");
  };
  const start = (event: TouchEvent) => {
    reset();
    const element = event.target as Element | null;
    if (event.touches.length !== 1 || !allowed() || !atTop() ||
      !element || !target.contains(element) || element.closest(EXCLUDED)) return;
    const button = element.closest("button");
    if (button && (!button.matches(SCORES_PULL_START) || !target.contains(button))) return;
    const touch = event.touches[0];
    gesture = { x: touch.clientX, y: touch.clientY, id: touch.identifier,
      scope: getContext().scopeKey, distance: 0, peak: 0, fromScoresRow: Boolean(button) };
  };
  const move = (event: TouchEvent) => {
    if (!gesture) return;
    if (event.touches.length !== 1 || !allowed() || !atTop() || gesture.scope !== getContext().scopeKey) {
      reset(); return;
    }
    const touch = event.touches[0];
    if (touch.identifier !== gesture.id) { reset(); return; }
    const dx = Math.abs(touch.clientX - gesture.x);
    const dy = touch.clientY - gesture.y;
    if (dy < -5 || (dx > 8 && dx > dy * 0.6) || gesture.peak - dy > 24) {
      reset(); return;
    }
    if (dy <= 8) return;
    // A browser-owned/non-cancelable scroll must not also trigger a custom refresh.
    if (!event.cancelable) { reset(); return; }
    event.preventDefault();
    gesture.distance = dy;
    gesture.peak = Math.max(gesture.peak, dy);
    onChange({ distance: Math.min(dy, threshold * 1.5), armed: dy >= threshold });
  };
  const end = (event: TouchEvent) => {
    const shouldRefresh = gesture && event.touches.length === 0 && allowed() && atTop() &&
      gesture.scope === getContext().scopeKey && gesture.distance >= threshold &&
      (!gesture.fromScoresRow || event.cancelable);
    const suppressClick = shouldRefresh && gesture?.fromScoresRow;
    reset();
    if (!shouldRefresh) return;
    // Cancel the compatibility click before refresh can detach these listeners.
    // Taps and sub-threshold releases retain their native button behavior.
    if (suppressClick) event.preventDefault();
    const scope = getContext().scopeKey;
    pending = true;
    // The page owns outcome feedback; this layer never infers successful data updates.
    void Promise.resolve().then(() => {
      const context = getContext();
      if (!disposed && context.scopeKey === scope && context.enabled && !context.isRefreshing) return onRefresh();
    }).catch(() => undefined).finally(() => { pending = false; });
  };
  target.addEventListener("touchstart", start, { passive: true });
  target.addEventListener("touchmove", move, { passive: false });
  target.addEventListener("touchend", end, { passive: false });
  target.addEventListener("touchcancel", reset, { passive: true });
  return () => {
    disposed = true;
    target.removeEventListener("touchstart", start);
    target.removeEventListener("touchmove", move);
    target.removeEventListener("touchend", end);
    target.removeEventListener("touchcancel", reset);
    if (previous) rootStyle.setProperty("overscroll-behavior-y", previous, priority);
    else rootStyle.removeProperty("overscroll-behavior-y");
    reset();
  };
}
