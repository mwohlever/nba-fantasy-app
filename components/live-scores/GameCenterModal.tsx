"use client";
import FootballGameCenter from "./FootballGameCenter";
import type { ComponentProps } from "react";

/** Compatibility shell for NFL lineup and NCAA football modal consumers. */
export default function GameCenterModal(props: ComponentProps<typeof FootballGameCenter>) {
  return <div className="fixed inset-0 z-[10000] bg-slate-950/55 p-0 sm:p-3" onClick={props.onClose}>
    <div className="mx-auto flex h-full max-h-none w-full max-w-3xl flex-col overflow-hidden bg-white shadow-xl sm:mt-4 sm:h-auto sm:max-h-[92vh] sm:rounded-2xl" onClick={event => event.stopPropagation()}>
      <FootballGameCenter {...props} presentation="modal" />
    </div>
  </div>;
}
