export type Broadcast = { network: string };
export type GameStory = { headline: string; description: string | null; url: string | null; source: string | null };

type Raw = Record<string, any>;

/** Prefer the US English national TV/streaming feed; never label radio as TV. */
export function normalizeBroadcast(competition: Raw | null | undefined): Broadcast | null {
  const detailed: Raw[] = [
    ...(Array.isArray(competition?.geoBroadcasts) ? competition.geoBroadcasts : []),
    ...(Array.isArray(competition?.broadcasts) ? competition.broadcasts : []),
  ];
  const candidates = detailed.filter((item) =>
    ["TV", "Streaming"].includes(item?.type?.shortName) &&
    (!item.region || item.region === "us") && (!item.lang || item.lang === "en") &&
    typeof item.media?.shortName === "string" && item.media.shortName.trim(),
  ).sort((a, b) => Number(b.isNational === true || b.market?.type === "National") - Number(a.isNational === true || a.market?.type === "National"));
  if (candidates[0]) return { network: candidates[0].media.shortName.trim() };
  // Scoreboard's compact names array is a fallback when detailed feeds are absent.
  if (detailed.some((item) => item?.type)) return null;
  const compact = detailed.filter((item) => Array.isArray(item?.names))
    .sort((a, b) => Number(b.market === "national") - Number(a.market === "national"));
  const name = compact.flatMap((item) => item.names).find((name) => typeof name === "string" && name.trim());
  return name ? { network: name.trim() } : null;
}

function publicEspnUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      !(url.hostname === "espn.com" || url.hostname.endsWith(".espn.com"))) return null;
    url.protocol = "https:";
    return url.href;
  } catch { return null; }
}

/** Only the event-linked recap, never summary.news (unrelated league headlines). */
export function normalizeGameStory(article: Raw | null | undefined, eventId: string, state: string): GameStory | null {
  if (state !== "post" || article?.type !== "Recap" || typeof article.headline !== "string") return null;
  const eventIds = [article.gameId, ...(Array.isArray(article.categories) ? article.categories
    .filter((category: Raw) => category.type === "event").map((category: Raw) => category.eventId ?? category.event?.id) : [])]
    .filter((id) => id != null).map(String);
  if (!eventIds.includes(eventId)) return null;
  return {
    headline: article.headline,
    description: typeof article.description === "string" ? article.description : null,
    url: publicEspnUrl(article.links?.web?.href),
    source: typeof article.source === "string" ? article.source : article.source?.name ?? null,
  };
}
