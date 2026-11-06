"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { playerCenterEnabled } from "@/lib/player-center/feature";
import PlayerProfileContent, { type PlayerProfileContentProps } from "./PlayerProfileContent";
import { mountPlayerModal, resetPlayerModalScroll } from "@/lib/client/playerModalLifecycle";

export default function PlayerCenterModal({ onClose, children, ...props }: PlayerProfileContentProps & { onClose: () => void; children?: ReactNode }) {
  const panel = useRef<HTMLElement>(null), close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    if (panel.current) return mountPlayerModal(panel.current, () => close.current());
  }, []);
  useEffect(() => { if (panel.current) resetPlayerModalScroll(panel.current); }, [props.sport, props.identity.id]);
  if (typeof document === "undefined") return null;
  return createPortal(<div className="pc pc-modal-overlay" data-sport={props.sport} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className="pc-modal-shell" role="dialog" aria-modal="true" aria-label={`${props.identity.name} player profile`}>
      <div className="pc-modal-top"><span>111 SPORTS · {playerCenterEnabled() || props.fixture ? "PLAYER CENTER" : "PLAYER"}</span><button type="button" onClick={onClose} aria-label="Close player profile">×</button></div>
      <div className="pc-modal-body"><PlayerProfileContent {...props} /></div>
      {children && <footer className="pc-modal-footer">{children}</footer>}
    </section>
  </div>, document.body);
}
