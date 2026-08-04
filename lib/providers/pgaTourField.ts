import "server-only";

const PGA_TOUR_SCHEDULE_URL =
  "https://data-api.pgatour.com/schedule/R";

const DEFAULT_PGA_API_KEY =
  "da2-gsrx5bibzbb4njvhl7t37wqyl4";

type UnknownRecord = Record<string, unknown>;

type ScheduleTournament = {
  tournamentId?: string | null;
  name?: string | null;
};

type RawFieldPlayer = {
  id?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  shortName?: string | null;
  displayName?: string | null;
  country?: string | null;
  countryFlag?: string | null;
  headshot?: string | null;
  qualifier?: string | null;
  alternate?: boolean | null;
  withdrawn?: boolean | null;
  status?: string | null;
  amateur?: boolean | null;
  owgr?: string | number | null;
  rankingPoints?: string | number | null;
};

export type PgaTourFieldPlayer = {
  pgaPlayerId: string;
  displayName: string;
  shortName: string;
  firstName: string | null;
  lastName: string | null;
  country: string | null;
  countryCode: string | null;
  headshotUrl: string | null;
  qualifier: string | null;
  isAlternate: boolean;
  isWithdrawn: boolean;
  isAmateur: boolean;
  status: string | null;
  owgrRank: number | null;
  rankingPoints: number | null;
};

export type PgaTourField = {
  tournamentId: string;
  tournamentName: string;
  year: string;
  fieldUrl: string;
  players: PgaTourFieldPlayer[];
};

function requestHeaders() {
  return {
    Accept: "application/json, text/html",
    "x-api-key":
      process.env.PGA_TOUR_API_KEY?.trim() ||
      DEFAULT_PGA_API_KEY,
    "x-pgat-platform": "web",
    Origin: "https://www.pgatour.com",
    Referer: "https://www.pgatour.com/",
    "User-Agent": "111 Sports",
  };
}

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function slugify(value: string) {
  return normalizeName(value)
    .replace(/\s+/g, "-");
}

function numberOrNull(value: unknown) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function isRecord(
  value: unknown,
): value is UnknownRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function resolveHeadshot(
  value: string | null | undefined,
) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed
    .replaceAll("${HEIGHT}", "160")
    .replaceAll("${WIDTH}", "160");
}

function displayNameForPlayer(
  player: RawFieldPlayer,
) {
  const firstName =
    player.firstName?.trim() ?? "";

  const lastName =
    player.lastName?.trim() ?? "";

  const naturalName =
    `${firstName} ${lastName}`.trim();

  if (naturalName) {
    return naturalName;
  }

  const supplied =
    player.displayName?.trim() ?? "";

  /*
   * PGA's field response often uses "Last, First".
   */
  if (supplied.includes(",")) {
    const [last, first] =
      supplied.split(",").map(
        (part) => part.trim(),
      );

    return `${first ?? ""} ${last ?? ""}`.trim();
  }

  return supplied;
}

function findFieldPlayerArray(
  value: unknown,
): RawFieldPlayer[] | null {
  if (Array.isArray(value)) {
    const playerRows =
      value.filter(
        (row): row is RawFieldPlayer =>
          isRecord(row) &&
          typeof row.id === "string" &&
          (
            typeof row.firstName === "string" ||
            typeof row.lastName === "string"
          ) &&
          (
            "qualifier" in row ||
            "alternate" in row ||
            "withdrawn" in row
          ),
      );

    if (
      value.length >= 20 &&
      playerRows.length >=
        Math.floor(value.length * 0.8)
    ) {
      return playerRows;
    }

    for (const child of value) {
      const found =
        findFieldPlayerArray(child);

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (isRecord(value)) {
    for (const child of Object.values(value)) {
      const found =
        findFieldPlayerArray(child);

      if (found) {
        return found;
      }
    }
  }

  return null;
}

async function fetchText(
  url: string,
  context: string,
) {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    25_000,
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: requestHeaders(),
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    });

    const text =
      await response.text();

    if (!response.ok) {
      throw new Error(
        `${context} failed (${response.status}): ` +
          text.slice(0, 300),
      );
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function findTournament(
  year: string,
  tournamentName: string,
) {
  const scheduleText =
    await fetchText(
      `${PGA_TOUR_SCHEDULE_URL}/${year}`,
      `PGA TOUR ${year} schedule`,
    );

  const schedule =
    JSON.parse(scheduleText) as {
      tournaments?: ScheduleTournament[];
    };

  const tournaments =
    Array.isArray(schedule.tournaments)
      ? schedule.tournaments
      : [];

  const normalizedTarget =
    normalizeName(tournamentName);

  const exact =
    tournaments.find(
      (row) =>
        typeof row.name === "string" &&
        normalizeName(row.name) ===
          normalizedTarget,
    ) ?? null;

  if (exact) {
    return exact;
  }

  return (
    tournaments.find((row) => {
      if (
        typeof row.name !== "string"
      ) {
        return false;
      }

      const normalized =
        normalizeName(row.name);

      return (
        normalized.includes(
          normalizedTarget,
        ) ||
        normalizedTarget.includes(
          normalized,
        )
      );
    }) ?? null
  );
}

export async function fetchPgaTourField(
  input: {
    year: string;
    tournamentName: string;
  },
): Promise<PgaTourField> {
  const tournament =
    await findTournament(
      input.year,
      input.tournamentName,
    );

  const tournamentId =
    tournament?.tournamentId?.trim();

  const tournamentName =
    tournament?.name?.trim();

  if (
    !tournamentId ||
    !tournamentName
  ) {
    throw new Error(
      `Could not match "${input.tournamentName}" ` +
        `to the PGA TOUR ${input.year} schedule.`,
    );
  }

  const fieldUrl =
    `https://www.pgatour.com/tournaments/` +
    `${input.year}/` +
    `${slugify(tournamentName)}/` +
    `${tournamentId}/field`;

  const html =
    await fetchText(
      fieldUrl,
      `${tournamentName} field page`,
    );

  const nextDataMatch =
    html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
    );

  if (!nextDataMatch?.[1]) {
    throw new Error(
      `${tournamentName} did not include __NEXT_DATA__.`,
    );
  }

  const nextData =
    JSON.parse(nextDataMatch[1]) as unknown;

  const rawPlayers =
    findFieldPlayerArray(nextData);

  if (
    !rawPlayers ||
    rawPlayers.length === 0
  ) {
    throw new Error(
      `${tournamentName} field data could not be located.`,
    );
  }

  const players =
    rawPlayers
      .map((player) => {
        const pgaPlayerId =
          player.id?.trim() ?? "";

        const displayName =
          displayNameForPlayer(player);

        if (
          !pgaPlayerId ||
          !displayName
        ) {
          return null;
        }

        return {
          pgaPlayerId,
          displayName,
          shortName:
            player.shortName?.trim() ||
            displayName,
          firstName:
            player.firstName?.trim() ||
            null,
          lastName:
            player.lastName?.trim() ||
            null,
          country:
            player.country?.trim() ||
            null,
          countryCode:
            player.countryFlag?.trim() ||
            null,
          headshotUrl:
            resolveHeadshot(
              player.headshot,
            ),
          qualifier:
            player.qualifier?.trim() ||
            null,
          isAlternate:
            Boolean(player.alternate),
          isWithdrawn:
            Boolean(player.withdrawn),
          isAmateur:
            Boolean(player.amateur),
          status:
            player.status?.trim() ||
            null,
          owgrRank:
            numberOrNull(player.owgr),
          rankingPoints:
            numberOrNull(
              player.rankingPoints,
            ),
        } satisfies PgaTourFieldPlayer;
      })
      .filter(
        (
          player,
        ): player is PgaTourFieldPlayer =>
          player !== null,
      );

  /*
   * Only the confirmed field belongs in the draft pool.
   * PGA provides alternates separately, but this also protects
   * us if they ever appear inside the main array.
   */
  const confirmedPlayers =
    players.filter(
      (player) =>
        !player.isAlternate &&
        !player.isWithdrawn &&
        player.status !== "OUT",
    );

  return {
    tournamentId,
    tournamentName,
    year: input.year,
    fieldUrl,
    players: confirmedPlayers,
  };
}
