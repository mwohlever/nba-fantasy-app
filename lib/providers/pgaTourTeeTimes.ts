import "server-only";

export type PgaTourTeeTime = {
  playerName: string;
  teeTimeRaw: string;
  roundNumber: number;
};

export type PgaTourTournamentRef = {
  tournamentId: string;
  tournamentUrl: string;
};

type FetchPgaTourTeeTimesInput = {
  tournamentUrl: string;
};

type ResolvePgaTourTournamentInput = {
  tournamentName: string;
  year: number;
};

const REQUEST_TIMEOUT_MS = 20_000;

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .replace(
      /[^a-z0-9]+/g,
      " ",
    )
    .trim();
}

function slugify(value: string) {
  return normalizeName(value)
    .replace(/\s+/g, "-");
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(
      /&#(\d+);/g,
      (_, code) =>
        String.fromCharCode(
          Number(code),
        ),
    );
}

function flattenHtml(html: string) {
  return decodeHtml(
    html
      .replace(
        /<script[\s\S]*?<\/script>/gi,
        " ",
      )
      .replace(
        /<style[\s\S]*?<\/style>/gi,
        " ",
      )
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function findNormalizedNamePosition(
  text: string,
  playerName: string,
) {
  const targetWords =
    normalizeName(playerName)
      .split(/\s+/)
      .filter(Boolean);

  if (targetWords.length === 0) {
    return null;
  }

  const words = [
    ...text.matchAll(
      /[\p{L}\p{N}'’-]+/gu,
    ),
  ]
    .map((match) => ({
      original:
        match[0],
      normalized:
        normalizeName(
          match[0],
        ),
      index:
        match.index ?? -1,
    }))
    .filter(
      (word) =>
        word.index >= 0 &&
        Boolean(word.normalized),
    );

  for (
    let index = 0;
    index <=
      words.length -
        targetWords.length;
    index++
  ) {
    const matches =
      targetWords.every(
        (targetWord, offset) =>
          words[index + offset]
            ?.normalized ===
          targetWord,
      );

    if (matches) {
      return words[index].index;
    }
  }

  return null;
}

function findClosestTimeBefore(
  text: string,
  position: number,
) {
  const start =
    Math.max(
      0,
      position - 260,
    );

  const window =
    text.slice(
      start,
      position,
    );

  const matches = [
    ...window.matchAll(
      /\b(\d{1,2}:\d{2}\s*(?:AM|PM))(?:\s*(UTC))?\b/gi,
    ),
  ];

  if (matches.length === 0) {
    return null;
  }

  const match =
    matches.at(-1);

  const time =
    match?.[1]
      ?.replace(/\s+/g, " ")
      .toUpperCase() ??
    null;

  if (!time) {
    return null;
  }

  const zone =
    match?.[2]
      ?.toUpperCase() ??
    null;

  return zone
    ? `${time} ${zone}`
    : time;
}

function findPublishedRoundNumber(
  pageText: string,
): number | null {
  /*
   * PGA's TeeTimesV2 payload exposes the tee sheet that is
   * actually selected/published as:
   *
   *   "defaultRound":1
   *
   * This is much safer than inferring the round from ESPN,
   * because tomorrow's pairings may not exist yet even after
   * today's round has started.
   */
  const defaultRoundMatch =
    pageText.match(
      /"defaultRound"\s*:\s*([1-4])/i,
    );

  if (defaultRoundMatch) {
    return Number(
      defaultRoundMatch[1],
    );
  }

  /*
   * Conservative fallbacks for PGA page variants.
   */
  const roundDisplayMatch =
    pageText.match(
      /"roundDisplay"\s*:\s*"R([1-4])"/i,
    );

  if (roundDisplayMatch) {
    return Number(
      roundDisplayMatch[1],
    );
  }

  const visibleRoundMatch =
    pageText.match(
      /\bR([1-4])\b/i,
    );

  if (visibleRoundMatch) {
    return Number(
      visibleRoundMatch[1],
    );
  }

  return null;
}

async function fetchPgaHtml(
  url: string,
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      REQUEST_TIMEOUT_MS,
    );

  try {
    const response =
      await fetch(
        url,
        {
          headers: {
            Accept:
              "text/html,application/xhtml+xml",
            "User-Agent":
              "111 Sports",
            Referer:
              "https://www.pgatour.com/",
          },
          cache: "no-store",
          signal:
            controller.signal,
        },
      );

    if (!response.ok) {
      throw new Error(
        `PGA TOUR request failed (${response.status})`,
      );
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

/*
 * Resolve the PGA TOUR tournament ID generically from PGA's
 * official season schedule.
 *
 * This avoids maintaining an ESPN -> PGA tournament-ID map.
 * PGA schedule links contain the canonical tournament slug and
 * ID, for example:
 *
 * /tournaments/2026/fedex-st-jude-championship/R2026027/...
 */
export async function resolvePgaTourTournament(
  input: ResolvePgaTourTournamentInput,
): Promise<PgaTourTournamentRef | null> {
  const tournamentName =
    input.tournamentName.trim();

  const year =
    Number(input.year);

  if (
    !tournamentName ||
    !Number.isInteger(year) ||
    year < 2000
  ) {
    return null;
  }

  const scheduleUrl =
    `https://www.pgatour.com/schedule/${year}`;

  const html =
    await fetchPgaHtml(
      scheduleUrl,
    );

  const targetSlug =
    slugify(
      tournamentName,
    );

  const links = [
    ...html.matchAll(
      new RegExp(
        `(?:https?:\\/\\/www\\.pgatour\\.com)?\\/tournaments\\/${year}\\/([^\\/"'?]+)\\/(R\\d{7})(?:\\/[^"'\\s<]*)?`,
        "gi",
      ),
    ),
  ];

  const candidates =
    links
      .map((match) => ({
        slug:
          String(
            match[1] ?? "",
          )
            .trim()
            .toLowerCase(),
        tournamentId:
          String(
            match[2] ?? "",
          )
            .trim()
            .toUpperCase(),
      }))
      .filter(
        (candidate) =>
          Boolean(
            candidate.slug,
          ) &&
          /^R\d{7}$/.test(
            candidate.tournamentId,
          ),
      );

  const exact =
    candidates.find(
      (candidate) =>
        candidate.slug ===
        targetSlug,
    );

  const normalized =
    exact ??
    candidates.find(
      (candidate) =>
        normalizeName(
          candidate.slug.replace(
            /-/g,
            " ",
          ),
        ) ===
        normalizeName(
          tournamentName,
        ),
    );

  if (!normalized) {
    return null;
  }

  return {
    tournamentId:
      normalized.tournamentId,
    tournamentUrl:
      `https://www.pgatour.com/tournaments/${year}/${normalized.slug}/${normalized.tournamentId}/tee-times`,
  };
}

export async function fetchPgaTourTeeTimes(
  input: FetchPgaTourTeeTimesInput,
  playerNames: string[],
): Promise<PgaTourTeeTime[]> {
  const html =
    await fetchPgaHtml(
      input.tournamentUrl,
    );

  const text =
    flattenHtml(html);

  const normalizedText =
    normalizeName(text);

  const publishedRoundNumber =
    findPublishedRoundNumber(text);

  if (publishedRoundNumber === null) {
    console.warn(
      "PGA TOUR tee-time page did not expose its published round",
      {
        tournamentUrl:
          input.tournamentUrl,
      },
    );

    return [];
  }

  const results:
    PgaTourTeeTime[] = [];

  for (
    const playerName
    of playerNames
  ) {
    const normalizedPlayer =
      normalizeName(
        playerName,
      );

    if (!normalizedPlayer) {
      continue;
    }

    /*
     * Require the full display name to exist on PGA's page.
     * This keeps the fallback conservative and avoids assigning
     * a time to a similarly named golfer.
     */
    if (
      !normalizedText.includes(
        normalizedPlayer,
      )
    ) {
      continue;
    }

    /*
     * Locate the actual full-name occurrence using normalized
     * word comparison rather than a literal surname regex.
     *
     * This preserves diacritics in the source text while letting
     * names such as Ludvig Åberg match safely.
     */
    const playerPosition =
      findNormalizedNamePosition(
        text,
        playerName,
      );

    if (
      playerPosition === null
    ) {
      continue;
    }

    const teeTimeRaw =
      findClosestTimeBefore(
        text,
        playerPosition,
      );

    if (!teeTimeRaw) {
      continue;
    }

    results.push({
      playerName,
      teeTimeRaw,
      roundNumber:
        publishedRoundNumber,
    });
  }

  return results;
}
