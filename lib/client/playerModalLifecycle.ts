type Modal = { panel: HTMLElement; close: () => void; restoreFocus: HTMLElement | null };
const stack: Modal[] = [];
let originalOverflow = "";
/** A new/reopened player starts at the header, including any prior action-footer scroll. */
export function resetPlayerModalScroll(panel: HTMLElement) {
  panel.scrollTop = 0;
  panel.querySelectorAll<HTMLElement>(".pc-modal-body, .pc-modal-footer").forEach(element => { element.scrollTop = 0; });
}
const focusable = (panel: HTMLElement) => Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), summary, a[href], [tabindex="0"]'))
  .filter(element => element.getClientRects().length > 0);

/** Only the top profile handles keys; handoffs and nested profiles share one scroll lock. */
export function mountPlayerModal(panel: HTMLElement, close: () => void) {
  const before = document.activeElement as HTMLElement | null;
  if (!stack.length) { originalOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
  const modal = { panel, close, restoreFocus: before }; stack.push(modal);
  focusable(panel)[0]?.focus();
  const key = (event: KeyboardEvent) => {
    if (stack.at(-1) !== modal) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); modal.close(); }
    if (event.key === "Tab") {
      const items = focusable(panel), first = items[0], last = items.at(-1);
      if (!items.length) { event.preventDefault(); return; }
      if (!panel.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    }
  };
  document.addEventListener("keydown", key, true);
  return () => {
    const wasTop = stack.at(-1) === modal;
    const index = stack.indexOf(modal); if (index >= 0) stack.splice(index, 1);
    for (const remaining of stack) {
      if (remaining.restoreFocus && panel.contains(remaining.restoreFocus)) remaining.restoreFocus = modal.restoreFocus;
    }
    document.removeEventListener("keydown", key, true);
    if (!stack.length) document.body.style.overflow = originalOverflow;
    if (wasTop) {
      const remaining = stack.at(-1);
      const target = modal.restoreFocus;
      if (target?.isConnected && (!remaining || remaining.panel.contains(target))) target.focus();
      else if (remaining) focusable(remaining.panel)[0]?.focus();
    }
  };
}
