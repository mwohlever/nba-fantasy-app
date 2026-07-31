const ESPN_GOLF_RANKINGS_URL =
  "https://www.espn.com/golf/rankings";

export type GolfWorldRanking = {
  rank: number;
  previousRank: number | null;
  points: number | null;
  playerName: string;
  espnPlayerId: string | null;
};

type FetchPageResult = {
  rankings: GolfWorldRanking[];
  url: string;
};

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCharCode(Number(code)),
    );
}

function stripHtml(value: string) {
  return decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function numberOrNull(value: string | null | undefined) {
  if (!value) return null;

  const normalized = value
    .trim()
    .replace(/,/g, "")
    .replace(/^[^\d+-]+/, "");

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function extractCells(rowHtml: string) {
  return Array.from(
    rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi),
  )
    .map((match) => stripHtml(match[1]))
    .filter(Boolean);
}

function extractPlayerId(rowHtml: string) {
  const patterns = [
    /\/golf\/player\/_\/id\/(\d+)/i,
    /\/golf\/player\/[^"'?]*\/id\/(\d+)/i,
    /"athleteId"\s*:\s*"?(\\d+)"?/i,
  ];

  for (const pattern of patterns) {
    const match = rowHtml.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

function looksLikePlayerName(value: string) {
  if (!value) return false;
  if (/^\d+(?:\.\d+)?$/.test(value)) return false;
  if (/^(rank|player|country|points|average|previous)$/i.test(value)) {
    return false;
  }

  return /[a-z]/i.test(value);
}

function parseRankingRows(html: string): GolfWorldRanking[] {
  const rows = Array.from(
    html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi),
  );

  const rankings: GolfWorldRanking[] = [];

  for (const rowMatch of rows) {
    const rowHtml = rowMatch[0];
    const cells = extractCells(rowHtml);

    if (cells.length < 2) continue;

    const rank = numberOrNull(cells[0]);

    if (
      rank === null ||
      !Number.isInteger(rank) ||
      rank <= 0 ||
      rank > 1000
    ) {
      continue;
    }

    const playerName =
      cells.find(
        (cell, index) =>
          index > 0 &&
          looksLikePlayerName(cell) &&
          !/^[A-Z]{2,3}$/.test(cell),
      ) ?? null;

    if (!playerName) continue;

    const numericCells = cells
      .slice(1)
      .map((cell) => numberOrNull(cell))
      .filter((value): value is number => value !== null);

    const previousRank =
      numericCells.find(
        (value) =>
          Number.isInteger(value) &&
          value >= 1 &&
          value <= 1000,
      ) ?? null;

    const points =
      [...numericCells]
        .reverse()
        .find((value) => !Number.isInteger(value) || value > 1000) ??
      null;

    rankings.push({
      rank,
      previousRank:
        previousRank === rank ? null : previousRank,
      points,
      playerName,
      espnPlayerId: extractPlayerId(rowHtml),
    });
  }

  return rankings;
}

function parseEmbeddedRankingObjects(
  html: string,
): GolfWorldRanking[] {
  const results: GolfWorldRanking[] = [];

  const objectMatches = html.matchAll(
    /\{[^{}]{0,1200}?"(?:rank|currentRank)"\s*:\s*(\d+)[^{}]{0,1200}?\}/gi,
  );

  for (const objectMatch of objectMatches) {
    const objectText = objectMatch[0];

    const rankMatch = objectText.match(
      /"(?:rank|currentRank)"\s*:\s*(\d+)/i,
    );

    const nameMatch =
      objectText.match(
        /"(?:displayName|fullName|playerName|name)"\s*:\s*"([^"]+)"/i,
      ) ?? null;

    if (!rankMatch || !nameMatch) continue;

    const rank = Number(rankMatch[1]);

    if (!Number.isInteger(rank) || rank <= 0 || rank > 1000) {
      continue;
    }

    const idMatch = objectText.match(
      /"(?:athleteId|playerId|id)"\s*:\s*"?(\\d+)"?/i,
    );

    const previousMatch = objectText.match(
      /"(?:previousRank|priorRank)"\s*:\s*(\d+)/i,
    );

    const pointsMatch = objectText.match(
      /"(?:points|averagePoints|avgPoints)"\s*:\s*"?([\d.]+)"?/i,
    );

    results.push({
      rank,
      previousRank: previousMatch
        ? Number(previousMatch[1])
        : null,
      points: pointsMatch
        ? Number(pointsMatch[1])
        : null,
      playerName: decodeHtml(nameMatch[1]),
      espnPlayerId: idMatch?.[1] ?? null,
    });
  }

  return results;
}

function deduplicateRankings(
  rankings: GolfWorldRanking[],
) {
  const byRank = new Map<number, GolfWorldRanking>();
  const byIdentity = new Set<string>();

  for (const ranking of rankings.sort((a, b) => a.rank - b.rank)) {
    const identity =
      ranking.espnPlayerId ??
      normalizeName(ranking.playerName);

    if (!identity || byIdentity.has(identity)) continue;
    if (byRank.has(ranking.rank)) continue;

    byIdentity.add(identity);
    byRank.set(ranking.rank, ranking);
  }

  return Array.from(byRank.values()).sort(
    (a, b) => a.rank - b.rank,
  );
}

async function fetchRankingPage(
  page: number,
): Promise<FetchPageResult> {
  const url =
    page === 1
      ? ESPN_GOLF_RANKINGS_URL
      : `${ESPN_GOLF_RANKINGS_URL}/_/page/${page}`;

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent":
        "Mozilla/5.0 (compatible; 111-Sports-Golf-Rankings/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(
      `ESPN rankings request failed for page ${page}: ` +
        `${response.status} ${response.statusText}`,
    );
  }

  const html = await response.text();

  const rankings = deduplicateRankings([
    ...parseRankingRows(html),
    ...parseEmbeddedRankingObjects(html),
  ]);

  return {
    rankings,
    url,
  };
}

export async function fetchEspnGolfWorldRankings(
  limit = 200,
) {
  const allRankings: GolfWorldRanking[] = [];
  const pagesAttempted: string[] = [];
  const pageErrors: string[] = [];

  for (let page = 1; page <= 5; page += 1) {
    try {
      const result = await fetchRankingPage(page);
      pagesAttempted.push(result.url);

      const beforeCount = allRankings.length;
      allRankings.push(...result.rankings);

      const deduplicated =
        deduplicateRankings(allRankings);

      allRankings.splice(
        0,
        allRankings.length,
        ...deduplicated,
      );

      if (allRankings.length >= limit) break;

      if (
        page > 1 &&
        allRankings.length === beforeCount
      ) {
        break;
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      pageErrors.push(message);

      if (page === 1) {
        throw error;
      }

      break;
    }
  }

  const rankings = deduplicateRankings(allRankings)
    .filter((ranking) => ranking.rank <= limit)
    .slice(0, limit);

  if (rankings.length === 0) {
    throw new Error(
      "ESPN rankings were downloaded, but no ranking rows could be parsed.",
    );
  }

  return {
    rankings,
    pagesAttempted,
    pageErrors,
  };
}
