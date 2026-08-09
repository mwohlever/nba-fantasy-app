import "server-only";

type PgaTourTeeTime = {
  playerName: string;
  teeTimeRaw: string;
};

type FetchPgaTourTeeTimesInput = {
  tournamentUrl: string;
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

function findClosestTimeBefore(
  text: string,
  position: number,
) {
  const start =
    Math.max(
      0,
      position - 220,
    );

  const window =
    text.slice(
      start,
      position,
    );

  const matches = [
    ...window.matchAll(
      /\b(\d{1,2}:\d{2}\s*(?:AM|PM))\b/gi,
    ),
  ];

  if (matches.length === 0) {
    return null;
  }

  return (
    matches.at(-1)?.[1]
      ?.replace(/\s+/g, " ")
      .toUpperCase() ??
    null
  );
}

export async function fetchPgaTourTeeTimes(
  input: FetchPgaTourTeeTimesInput,
  playerNames: string[],
): Promise<PgaTourTeeTime[]> {
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
        input.tournamentUrl,
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
        `PGA TOUR tee-times page failed (${response.status})`,
      );
    }

    const html =
      await response.text();

    const text =
      flattenHtml(html);

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
       * Search the flattened PGA TOUR page text.
       *
       * We intentionally require a full display-name match.
       * This keeps the fallback conservative and prevents
       * accidental tee-time assignment to similarly named players.
       */
      const normalizedText =
        normalizeName(text);

      let normalizedIndex =
        normalizedText.indexOf(
          normalizedPlayer,
        );

      if (
        normalizedIndex < 0
      ) {
        continue;
      }

      /*
       * The normalized string cannot safely be used as an index
       * into the original text because punctuation/whitespace
       * lengths differ. Find the player's component words in the
       * original page instead.
       */
      const words =
        playerName
          .trim()
          .split(/\s+/)
          .filter(Boolean);

      const surname =
        words.at(-1);

      if (!surname) {
        continue;
      }

      const surnameRegex =
        new RegExp(
          `\\b${surname.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
          )}\\b`,
          "i",
        );

      const surnameMatch =
        surnameRegex.exec(text);

      if (!surnameMatch) {
        continue;
      }

      const teeTimeRaw =
        findClosestTimeBefore(
          text,
          surnameMatch.index,
        );

      if (!teeTimeRaw) {
        continue;
      }

      results.push({
        playerName,
        teeTimeRaw,
      });
    }

    return results;
  } finally {
    clearTimeout(timeout);
  }
}
