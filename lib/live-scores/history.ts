import { liveBackMatches, type LiveOverviewEntry } from "./urlState";

const markerKey = "sports111LiveOverview";
/** Next synchronizes native history with useSearchParams and retains its router fields. */
export function replaceLiveHref(href: string) {
  window.history.replaceState({ [markerKey]: window.history.state?.[markerKey] ?? null }, "", href);
}
export function pushLiveGame(href: string, entry: LiveOverviewEntry) {
  window.history.pushState({ [markerKey]: entry }, "", href);
  window.scrollTo?.({ top: 0 });
}
export function backToLiveGames(overview: string, gameId: string, scope: string) {
  const entry = window.history.state?.[markerKey] as LiveOverviewEntry | undefined;
  if (liveBackMatches(entry, overview, gameId, scope)) window.history.back();
  else window.history.replaceState(null, "", overview);
  window.scrollTo?.({ top: 0 });
}
