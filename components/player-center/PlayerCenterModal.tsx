"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { playerCenterEnabled } from "@/lib/player-center/feature";
import PlayerBasics from "./PlayerBasics";
import PlayerCenter, { type PlayerCenterProps } from "./PlayerCenter";

export default function PlayerCenterModal({ onClose, children, ...props }: PlayerCenterProps & { onClose: () => void; children?: ReactNode }) {
  const panel = useRef<HTMLElement>(null), close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null, previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key === "Tab") {
        const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), summary, a[href], [tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("keydown", key, true); document.body.style.overflow = previousOverflow; if (before?.isConnected) before.focus(); };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(<div className="pc pc-modal-overlay" data-sport={props.sport} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className="pc-modal-shell" role="dialog" aria-modal="true" aria-label={`${props.identity.name} player profile`}>
      <div className="pc-modal-top"><span>111 SPORTS · {playerCenterEnabled() || props.fixture ? "PLAYER CENTER" : "PLAYER"}</span><button type="button" onClick={onClose} aria-label="Close player profile">×</button></div>
      <div className="pc-modal-body">{playerCenterEnabled() || props.fixture ? <PlayerCenter {...props} /> : <PlayerBasics identity={props.identity} />}</div>
      {children && <footer className="pc-modal-footer">{children}</footer>}
    </section>
  </div>, document.body);
}
