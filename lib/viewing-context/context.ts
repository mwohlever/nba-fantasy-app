import { formatFantasySlateLabel } from "../formatSlateLabel";
import { parseDraftSlateId } from "../lineups/draftContext";

export type ViewingGame = "nba" | "nfl" | "golf" | "nba-skins";
export type ViewingDimension = "slate" | "season";
export type ViewingOption = { value: number; label: string };

/** All seasons remain directly selectable; distinguish repeated week/event names. */
export function slateViewingOptions(slates: readonly { id: number; date?: string | null;
  start_date?: string | null; end_date?: string | null; display_name?: string | null; label?: string | null }[],
  sport: Exclude<ViewingGame, "nba-skins">): ViewingOption[] {
  return slates.map(slate => {
    const label = formatFantasySlateLabel({ ...slate, sport });
    const year = (slate.start_date ?? slate.date ?? "").slice(0, 4);
    return { value: slate.id, label: sport !== "nba" && year && !label.includes(year) ? `${year} · ${label}` : label };
  });
}

export function viewingStorageKey(groupId: string, game: ViewingGame, dimension: ViewingDimension) {
  return `111:viewing-context:v1:${encodeURIComponent(groupId)}:${game}:${dimension}`;
}

export function parseViewingValue(value: string | null | undefined) {
  return parseDraftSlateId(value ?? undefined);
}

/** IDs are hints. Callers must supply the authoritative active Group/game list. */
export function resolveViewingValue({ explicit, remembered, available, fallback }: {
  explicit?: string | null;
  remembered?: string | null;
  available: readonly number[];
  fallback: number | null;
}) {
  for (const candidate of [parseViewingValue(explicit), parseViewingValue(remembered), fallback]) {
    if (candidate !== null && available.includes(candidate)) return candidate;
  }
  return available[0] ?? null;
}

export function readViewingMemory(storage: Pick<Storage, "getItem">, key: string) {
  try { return storage.getItem(key); } catch { return null; }
}

export function writeViewingMemory(storage: Pick<Storage, "setItem" | "removeItem">, key: string, value: number | null) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, String(value));
  } catch { /* Browser storage is optional; the URL remains usable. */ }
}

export function viewingUrl(pathname: string, search: string, game: ViewingGame, value: number | null) {
  const params = new URLSearchParams(search);
  const dimension = game === "nba-skins" ? "season" : "slateId";
  if (game !== "nba-skins") params.set("sport", game);
  params.delete(game === "nba-skins" ? "slateId" : "season");
  if (value === null) params.delete(dimension);
  else params.set(dimension, String(value));
  return `${pathname}${params.size ? `?${params}` : ""}`;
}

export function sharesViewingContext(pathname: string, game: string) {
  return game === "nba-skins"
    ? ["/nba-skins", "/nba-skins/draft", "/nba-skins/standings"].includes(pathname)
    : ["nba", "nfl", "golf"].includes(game) &&
      ["/home", "/lineups/draft", "/lineups/scores"].includes(pathname);
}

/** Carry only same-game context between the pages that actually consume it. */
export function viewingNavigationHref(href: string, game: string, sourcePath: string, sourceSearch: string) {
  const [path, search = ""] = href.split("?");
  if (!sharesViewingContext(path, game)) return href;
  const params = new URLSearchParams(search);
  const source = new URLSearchParams(sourceSearch);
  const key = game === "nba-skins" ? "season" : "slateId";
  if (sharesViewingContext(sourcePath, game) && (game === "nba-skins" || source.get("sport") === game)) {
    const value = parseViewingValue(source.get(key));
    if (value !== null) params.set(key, String(value));
  }
  return `${path}${params.size ? `?${params}` : ""}`;
}
