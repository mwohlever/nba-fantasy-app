"use client";

import { Fragment } from "react";
import { useViewingContext } from "@/lib/viewing-context/useViewingContext";
import type { FantasySport } from "@/lib/lineups/draftContext";
import type { ViewingOption } from "@/lib/viewing-context/context";
import ViewingContextSelector from "@/components/ui/ViewingContextSelector";

export default function SlateViewingBoundary({ groupId, sport, options, selectedId, children }: {
  groupId: string;
  sport: FantasySport;
  options: ViewingOption[];
  selectedId: number | null;
  children: React.ReactNode;
}) {
  const context = useViewingContext({ game: sport, options, fallback: selectedId,
    serverGroupId: groupId, serverValue: selectedId });
  return <>
    <ViewingContextSelector label={sport === "golf" ? "Tournament" : sport === "nfl" ? "Week" : "Slate"}
      value={context.value} options={options} onChange={context.select} disabled={!context.ready} />
    {context.missingGroup ? <p role="alert" className="py-4 text-sm">No active Group is available.</p> : context.matchesServer ? <Fragment key={`${groupId}:${sport}:${selectedId}`}>{children}</Fragment>
      : <p className="py-4 text-sm text-[var(--app-text-muted)]">Loading selected {sport === "golf" ? "tournament" : "slate"}…</p>}
  </>;
}
