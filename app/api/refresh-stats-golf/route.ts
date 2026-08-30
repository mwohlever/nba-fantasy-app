import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { calculateGolfCutLine } from "@/lib/golf/cutLine";
import {
  calculateGolfPenaltyStrokes,
  GOLF_TOURNAMENT_ROUNDS,
} from "@/lib/scoring/golf";
import { notifyNewlyFinishedPlayers } from "@/lib/playerFinishedNotifications";
import { notifyCompletedSlate } from "@/lib/slateCompleteNotifications";
import {
  fetchGolfCoursesByEventId,
  fetchGolfTournamentByEventId,
  parseGolfTournamentByEventIdFromPayload,
  type GolfCompetitor,
  type GolfCompetitorStatus,
  type GolfRound,
  type GolfTournament,
} from "@/lib/providers/golf";

import {
  fetchPgaTourTeeTimes,
  resolvePgaTourTournament,
} from "@/lib/providers/pgaTourTeeTimes";

type RefreshBody = {
  slateId?: number | string;
  scoreboardPayload?: unknown;
  reconcileLockedLifecycle?: boolean;
};

type GolfSlateRecord = {
  id: number;
  sport: string;
  display_name: string | null;
  external_event_id: string | null;
  start_date: string;
  end_date: string;
  is_locked: boolean;
  cut_penalty_per_round: number | null;
  has_cut: boolean;
};

type GolfPlayerIdRow = {
  id: number;
  display_name?: string;
  espn_player_id: string;
};

type GolfEventPlayerIdRow = {
  id: number;
  player_id: number;
};

type GolfRoundIdRow = {
  id: number;
  event_player_id: number;
  round_number: number;
};

type DatabaseError = {
  message: string;
};

const EXPECTED_TOURNAMENT_ROUNDS = GOLF_TOURNAMENT_ROUNDS;
const INSERT_BATCH_SIZE = 750;

function normalizeGolfNameKey(
  value: string,
) {
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

function pgaUtcTeeTimeToIso(input: {
  raw: string;
  tournamentStartDate: string | null;
  roundNumber: number;
}): string | null {
  const match =
    input.raw
      .trim()
      .match(
        /^(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s*UTC)?$/i,
      );

  if (
    !match ||
    !input.tournamentStartDate
  ) {
    return null;
  }

  const start =
    new Date(
      input.tournamentStartDate,
    );

  if (
    Number.isNaN(
      start.getTime(),
    )
  ) {
    return null;
  }

  let hour =
    Number(match[1]);

  const minute =
    Number(match[2]);

  const meridiem =
    match[3].toUpperCase();

  if (
    !Number.isInteger(hour) ||
    hour < 1 ||
    hour > 12 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  if (hour === 12) {
    hour = 0;
  }

  if (meridiem === "PM") {
    hour += 12;
  }

  const roundDate =
    new Date(
      Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth(),
        start.getUTCDate() +
          Math.max(
            0,
            input.roundNumber - 1,
          ),
        hour,
        minute,
        0,
        0,
      ),
    );

  return roundDate.toISOString();
}

function parseSlateId(value: unknown): number | null {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function getTournamentYear(startDate: string): string | null {
  const year = startDate.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}

function deduplicateCompetitors(
  competitors: GolfCompetitor[],
): GolfCompetitor[] {
  return Array.from(
    new Map(
      competitors.map((competitor) => [competitor.espnPlayerId, competitor]),
    ).values(),
  );
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

function getRoundStatus(
  round: GolfRound,
  tournamentStatus: GolfTournament["status"],
): "scheduled" | "active" | "finished" | "not_played" {
  if (round.holesCompleted === 18) {
    return "finished";
  }

  if (round.holesCompleted > 0) {
    return "active";
  }

  if (round.strokes !== null && round.strokes > 0) {
    return "active";
  }

  return tournamentStatus === "scheduled" ? "scheduled" : "not_played";
}

function normalizeGolfCompetitorState(
  competitor: GolfCompetitor,
  tournament: GolfTournament,
): GolfCompetitor {
  const rounds =
    [...competitor.rounds].sort(
      (a, b) =>
        Number(a.roundNumber) -
        Number(b.roundNumber),
    );

  const completedRounds =
    rounds.filter(
      (round) =>
        Number(
          round.holesCompleted ?? 0,
        ) >= 18,
    );

  const activeRound =
    rounds
      .filter((round) => {
        const holes =
          Number(
            round.holesCompleted ?? 0,
          );

        return (
          (holes > 0 && holes < 18) ||
          (
            holes < 18 &&
            round.strokes !== null &&
            Number(round.strokes) > 0
          )
        );
      })
      .at(-1) ?? null;

  const playedRounds =
    rounds.filter(
      (round) =>
        Number(
          round.holesCompleted ?? 0,
        ) > 0 ||
        (
          round.strokes !== null &&
          Number(round.strokes) > 0
        ),
    );

  const latestPlayedRound =
    playedRounds.at(-1) ?? null;

  const latestCompletedRound =
    completedRounds.at(-1) ?? null;

  const completedRoundNumber =
    latestCompletedRound
      ? Number(
          latestCompletedRound.roundNumber,
        )
      : 0;

  const derivedRoundsCompleted =
    Math.max(
      Number(
        competitor.roundsCompleted ?? 0,
      ),
      completedRoundNumber,
    );

  const holesFromRounds =
    rounds.reduce(
      (sum, round) =>
        sum +
        Math.max(
          0,
          Math.min(
            18,
            Number(
              round.holesCompleted ?? 0,
            ),
          ),
        ),
      0,
    );

  const derivedHolesCompleted =
    Math.max(
      Number(
        competitor.holesCompleted ?? 0,
      ),
      holesFromRounds,
    );

  const tournamentRoundRaw =
    Number(
      tournament.currentRound ?? 0,
    );

  const tournamentRound =
    Number.isFinite(
      tournamentRoundRaw,
    ) &&
    tournamentRoundRaw > 0
      ? Math.min(
          EXPECTED_TOURNAMENT_ROUNDS,
          Math.max(
            1,
            tournamentRoundRaw,
          ),
        )
      : null;

  const providerRoundRaw =
    Number(
      competitor.currentRound ?? 0,
    );

  const providerRound =
    Number.isFinite(
      providerRoundRaw,
    ) &&
    providerRoundRaw > 0
      ? Math.min(
          EXPECTED_TOURNAMENT_ROUNDS,
          Math.max(
            1,
            providerRoundRaw,
          ),
        )
      : null;

  const latestPlayedRoundNumber =
    latestPlayedRound
      ? Number(
          latestPlayedRound.roundNumber,
        )
      : null;

  const noScoringActivity =
    playedRounds.length === 0 &&
    derivedRoundsCompleted === 0 &&
    derivedHolesCompleted === 0;

  const tournamentHasStarted =
    tournament.status !== "scheduled";

  /*
   * A future-round tee time can be published before the current
   * tournament day is over. Keep that tee time, but do not let it
   * erase today's completed-round state.
   *
   * Example:
   *   Saturday: R3 complete + Sunday R4 tee time exists
   *     -> round_complete
   *
   *   Sunday: R4 tee-time calendar date has arrived
   *     -> scheduled until the golfer starts
   *
   * Compare calendar dates in America/New_York because PGA tournament
   * day/status presentation in the app is Eastern-time based.
   */
  const easternDateKey = (
    value: Date | string,
  ): string | null => {
    const date =
      value instanceof Date
        ? value
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const parts =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone: "America/New_York",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        },
      ).formatToParts(date);

    const year =
      parts.find(
        (part) => part.type === "year",
      )?.value;

    const month =
      parts.find(
        (part) => part.type === "month",
      )?.value;

    const day =
      parts.find(
        (part) => part.type === "day",
      )?.value;

    return year && month && day
      ? `${year}-${month}-${day}`
      : null;
  };

  const nextRound =
    rounds.find(
      (round) =>
        Number(round.roundNumber) ===
          derivedRoundsCompleted + 1 &&
        Number(
          round.holesCompleted ?? 0,
        ) === 0 &&
        (
          round.strokes === null ||
          Number(round.strokes) === 0
        ),
    ) ?? null;

  const nextRoundTeeTime =
    nextRound?.teeTime ?? null;

  const todayEastern =
    easternDateKey(new Date());

  const nextRoundDateEastern =
    nextRoundTeeTime
      ? easternDateKey(nextRoundTeeTime)
      : null;

  const nextRoundDayHasArrived =
    nextRoundDateEastern !== null &&
    todayEastern !== null &&
    nextRoundDateEastern <= todayEastern;

  const terminalStatuses =
    new Set<GolfCompetitorStatus>([
      "finished",
      "cut",
      "withdrawn",
      "disqualified",
      "did_not_start",
    ]);

  let normalizedStatus:
    GolfCompetitorStatus =
      competitor.status;

  /*
   * Provider status is authoritative for true terminal states.
   * Otherwise the actual round data wins.
   */
  if (
    !terminalStatuses.has(
      competitor.status,
    )
  ) {
    if (activeRound) {
      normalizedStatus = "active";
    } else if (noScoringActivity) {
      normalizedStatus = "scheduled";
    } else if (
      tournament.status === "final" &&
      derivedRoundsCompleted >=
        EXPECTED_TOURNAMENT_ROUNDS
    ) {
      normalizedStatus = "finished";
    } else if (
      tournamentRound !== null &&
      tournamentRound >
        derivedRoundsCompleted &&
      derivedRoundsCompleted > 0 &&
      nextRoundDayHasArrived
    ) {
      /*
       * The next competitive day has actually arrived for this golfer.
       * It is now correct to reset the daily completion state and show
       * the golfer as upcoming until the next round begins.
       *
       * Merely receiving tomorrow's tee time does NOT trigger this.
       */
      normalizedStatus = "scheduled";
    } else if (
      latestCompletedRound
    ) {
      normalizedStatus =
        "round_complete";
    }
  }

  let normalizedCurrentRound:
    number | null =
      providerRound;

  if (activeRound) {
    normalizedCurrentRound =
      Number(
        activeRound.roundNumber,
      );
  } else if (
    normalizedStatus === "scheduled"
  ) {
    normalizedCurrentRound =
      tournamentHasStarted &&
      tournamentRound !== null
        ? Math.max(
            tournamentRound,
            Math.min(
              EXPECTED_TOURNAMENT_ROUNDS,
              derivedRoundsCompleted + 1,
            ),
          )
        : providerRound ??
          Math.min(
            EXPECTED_TOURNAMENT_ROUNDS,
            Math.max(
              1,
              derivedRoundsCompleted + 1,
            ),
          );
  } else if (
    latestPlayedRoundNumber !== null
  ) {
    normalizedCurrentRound =
      latestPlayedRoundNumber;
  }

  /*
   * An unplayed golfer cannot legitimately own a live tournament
   * score or leaderboard position. ESPN/PGA occasionally leaves
   * placeholder field order / even-par values attached to such a
   * golfer after the tournament begins.
   */
  const clearUnplayedLeaderboardData =
    tournamentHasStarted &&
    noScoringActivity &&
    !terminalStatuses.has(
      competitor.status,
    );

  return {
    ...competitor,

    rounds,

    roundsCompleted:
      derivedRoundsCompleted,

    holesCompleted:
      derivedHolesCompleted,

    currentRound:
      normalizedCurrentRound,

    status:
      normalizedStatus,

    lastHole:
      noScoringActivity
        ? null
        : competitor.lastHole,

    leaderboardOrder:
      clearUnplayedLeaderboardData
        ? null
        : competitor.leaderboardOrder,

    officialScoreToPar:
      clearUnplayedLeaderboardData
        ? null
        : competitor.officialScoreToPar,

    officialScoreDisplay:
      clearUnplayedLeaderboardData
        ? null
        : competitor.officialScoreDisplay,
  };
}

async function fetchTournamentForSlate(
  slate: GolfSlateRecord,
  scoreboardPayload?: unknown,
): Promise<GolfTournament | null> {
  const eventId =
    slate.external_event_id?.trim();

  if (!eventId) {
    return null;
  }

  if (
    scoreboardPayload !==
    undefined
  ) {
    return parseGolfTournamentByEventIdFromPayload(
      scoreboardPayload,
      eventId,
    );
  }

  const tournamentYear =
    getTournamentYear(
      slate.start_date,
    );

  if (tournamentYear) {
    const tournament =
      await fetchGolfTournamentByEventId(
        eventId,
        tournamentYear,
      );

    if (tournament) {
      return tournament;
    }
  }

  return fetchGolfTournamentByEventId(
    eventId,
  );
}

async function upsertInBatches(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<DatabaseError | null> {
  for (const batch of chunkRows(rows, INSERT_BATCH_SIZE)) {
    const { error } = await supabaseAdmin
      .from(table)
      .upsert(batch, {
        onConflict,
      });

    if (error) {
      return {
        message: error.message,
      };
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    let body: RefreshBody;

    try {
      body = (await request.json()) as RefreshBody;
    } catch {
      return NextResponse.json(
        {
          error: "A valid JSON request body is required.",
        },
        { status: 400 },
      );
    }

    const slateId =
      parseSlateId(body.slateId);

    const isPayloadIngestion =
      body.scoreboardPayload !==
      undefined;

    if (isPayloadIngestion) {
      const expectedSecret =
        process.env
          .GOLF_CRON_SECRET
          ?.trim();

      const authorization =
        request.headers.get(
          "authorization",
        );

      const hasCronAuthorization =
        Boolean(
          expectedSecret &&
          authorization ===
            `Bearer ${expectedSecret}`,
        );

      const currentUser =
        hasCronAuthorization
          ? null
          : await getCurrentUser();

      if (
        !hasCronAuthorization &&
        !currentUser
      ) {
        return NextResponse.json(
          {
            error: "Login required.",
          },
          {
            status: 401,
          },
        );
      }
    }

    if (!slateId) {
      return NextResponse.json(
        { error: "A valid slateId is required." },
        { status: 400 },
      );
    }

    const { data: slateData, error: slateError } = await supabaseAdmin
      .from("slates")
      .select(
        [
          "id",
          "sport",
          "display_name",
          "external_event_id",
          "start_date",
          "end_date",
          "is_locked",
          "cut_penalty_per_round",
          "has_cut",
        ].join(","),
      )
      .eq("id", slateId)
      .single();

    if (slateError || !slateData) {
      return NextResponse.json({ error: "Slate not found." }, { status: 404 });
    }

    const slate = slateData as unknown as GolfSlateRecord;

    if (slate.sport !== "golf") {
      return NextResponse.json(
        {
          error: "This slate is not a Golf slate.",
        },
        { status: 400 },
      );
    }

    if (
      slate.is_locked &&
      body.reconcileLockedLifecycle !== true
    ) {
      return NextResponse.json(
        {
          error: "This slate is locked and cannot be refreshed.",
        },
        { status: 400 },
      );
    }

    if (!slate.external_event_id?.trim()) {
      return NextResponse.json(
        {
          error: "This Golf slate does not have an ESPN external event ID.",
        },
        { status: 400 },
      );
    }

    const tournament =
      await fetchTournamentForSlate(
        slate,
        body.scoreboardPayload,
      );

    if (!tournament) {
      return NextResponse.json(
        {
          error: `ESPN tournament ${slate.external_event_id} was not found.`,
        },
        { status: 404 },
      );
    }

    if (
      slate.is_locked &&
      body.reconcileLockedLifecycle === true
    ) {
      if (
        tournament.status !== "final" ||
        !tournament.completed
      ) {
        return NextResponse.json(
          {
            error:
              "Locked Golf lifecycle reconciliation requires an authoritative final tournament.",
          },
          { status: 409 },
        );
      }

      const refreshedAt = new Date().toISOString();
      const competitors = deduplicateCompetitors(
        tournament.competitors,
      ).map((competitor) =>
        normalizeGolfCompetitorState(
          competitor,
          tournament,
        ),
      );

      const {
        data: existingEventPlayerData,
        error: existingEventPlayerError,
      } = await supabaseAdmin
        .from("golf_event_players")
        .select("id, player_id")
        .eq("slate_id", slateId);

      if (existingEventPlayerError) {
        return NextResponse.json(
          { error: existingEventPlayerError.message },
          { status: 500 },
        );
      }

      const existingEventPlayers =
        (existingEventPlayerData ?? []) as GolfEventPlayerIdRow[];
      const playerIds = existingEventPlayers.map((row) => Number(row.player_id));
      const { data: golfPlayerData, error: golfPlayerError } =
        playerIds.length > 0
          ? await supabaseAdmin
              .from("golf_players")
              .select("id, espn_player_id")
              .in("id", playerIds)
          : { data: [], error: null };

      if (golfPlayerError) {
        return NextResponse.json(
          { error: golfPlayerError.message },
          { status: 500 },
        );
      }

      const eventPlayerByEspnId = new Map(
        (golfPlayerData ?? []).flatMap((player) => {
          const eventPlayer = existingEventPlayers.find(
            (row) => Number(row.player_id) === Number(player.id),
          );

          return eventPlayer
            ? [[String(player.espn_player_id), eventPlayer] as const]
            : [];
        }),
      );

      const matchedCompetitors = competitors.flatMap((competitor) => {
        const eventPlayer = eventPlayerByEspnId.get(competitor.espnPlayerId);
        return eventPlayer ? [{ competitor, eventPlayer }] : [];
      });

      const lifecycleRows = matchedCompetitors.map(
        ({ competitor, eventPlayer }) => ({
          id: eventPlayer.id,
          slate_id: slateId,
          player_id: eventPlayer.player_id,
          rounds_completed: competitor.roundsCompleted,
          holes_completed: competitor.holesCompleted,
          current_round: competitor.currentRound,
          last_hole: competitor.lastHole,
          status: competitor.status,
          tee_time: competitor.teeTime,
          tee_time_raw: competitor.teeTimeRaw,
          updated_at: refreshedAt,
        }),
      );

      if (lifecycleRows.length > 0) {
        const { error } = await supabaseAdmin
          .from("golf_event_players")
          .upsert(lifecycleRows, { onConflict: "id" });

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }

      const roundRows = matchedCompetitors.flatMap(
        ({ competitor, eventPlayer }) =>
          competitor.rounds.map((round) => ({
            event_player_id: eventPlayer.id,
            round_number: round.roundNumber,
            score_to_par: round.scoreToPar,
            score_display: round.scoreDisplay,
            strokes: round.strokes,
            holes_completed: round.holesCompleted,
            tee_time: round.teeTime,
            tee_time_raw: round.teeTimeRaw,
            status: getRoundStatus(round, tournament.status),
            updated_at: refreshedAt,
          })),
      );

      const roundsError = await upsertInBatches(
        "golf_rounds",
        roundRows,
        "event_player_id,round_number",
      );

      if (roundsError) {
        return NextResponse.json(
          { error: roundsError.message },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        slateId,
        refreshedAt,
        reconciliation: "locked_terminal_lifecycle",
        tournament: {
          eventId: tournament.espnEventId,
          status: tournament.status,
          completed: tournament.completed,
        },
        eventPlayersUpdated: lifecycleRows.length,
        roundsUpserted: roundRows.length,
        teamResultsUpdated: 0,
      });
    }

    const rawCompetitors =
      deduplicateCompetitors(
        tournament.competitors,
      );

    const normalizedCompetitors =
      rawCompetitors.map(
        (competitor) =>
          normalizeGolfCompetitorState(
            competitor,
            tournament,
          ),
      );

    /*
     * The cut is a 36-hole decision.
     *
     * Once Round 3 begins, officialScoreToPar includes Saturday scoring,
     * so it must NOT be used to decide who made the Friday cut.
     *
     * Derive each golfer's cut score from R1 + R2 only and keep that
     * eligibility stable for the rest of the tournament.
     */
    function getThirtySixHoleScore(
      competitor: GolfCompetitor,
    ): number | null {
      const firstTwoRounds =
        competitor.rounds
          .filter(
            (round) =>
              Number(round.roundNumber) === 1 ||
              Number(round.roundNumber) === 2,
          )
          .sort(
            (a, b) =>
              Number(a.roundNumber) -
              Number(b.roundNumber),
          );

      if (firstTwoRounds.length < 2) {
        return null;
      }

      const roundOne =
        firstTwoRounds.find(
          (round) =>
            Number(round.roundNumber) === 1,
        );

      const roundTwo =
        firstTwoRounds.find(
          (round) =>
            Number(round.roundNumber) === 2,
        );

      if (
        roundOne?.scoreToPar === null ||
        roundOne?.scoreToPar === undefined ||
        roundTwo?.scoreToPar === null ||
        roundTwo?.scoreToPar === undefined
      ) {
        return null;
      }

      const score =
        Number(roundOne.scoreToPar) +
        Number(roundTwo.scoreToPar);

      return Number.isFinite(score)
        ? score
        : null;
    }

    const officialCut =
      slate.has_cut
        ? calculateGolfCutLine(
            normalizedCompetitors.map(
          (competitor) => ({
            score:
              getThirtySixHoleScore(
                competitor,
              ) ??
              (
                Number(
                  competitor.currentRound ?? 0,
                ) <= 2
                  ? competitor.officialScoreToPar
                  : null
              ),
            status:
              competitor.status,
            position:
              competitor.leaderboardOrder,
            holesCompleted:
              competitor.holesCompleted,
            roundsCompleted:
              competitor.roundsCompleted,
            currentRound:
              competitor.currentRound,
              }),
            ),
          )
        : null;

    const protectedTerminalStatuses =
      new Set<GolfCompetitorStatus>([
        "finished",
        "withdrawn",
        "disqualified",
        "did_not_start",
      ]);

    const competitors =
      officialCut?.official
        ? normalizedCompetitors.map(
            (competitor) => {
              const cutScore =
                getThirtySixHoleScore(
                  competitor,
                );

              /*
               * Before Round 3 begins, the cumulative tournament score is
               * still equivalent to the 36-hole score, so retain the
               * fallback for Friday cut processing.
               */
              const score =
                cutScore ??
                (
                  Number(
                    competitor.currentRound ?? 0,
                  ) <= 2
                    ? competitor.officialScoreToPar
                    : null
                );

              if (
                score === null ||
                score === undefined ||
                !Number.isFinite(
                  Number(score),
                ) ||
                protectedTerminalStatuses.has(
                  competitor.status,
                )
              ) {
                return competitor;
              }

              /*
               * The golfer made the official 36-hole cut.
               *
               * An earlier Round-3 refresh may have incorrectly changed
               * this golfer to CUT after Saturday scoring moved the live
               * leaderboard. Recover that stale state here.
               */
              if (
                Number(score) <=
                officialCut.score
              ) {
                if (
                  competitor.status ===
                    "cut" &&
                  Number(
                    tournament.currentRound ?? 0,
                  ) >= 3
                ) {
                  return {
                    ...competitor,
                    status:
                      "scheduled" as GolfCompetitorStatus,
                    currentRound:
                      Math.max(
                        3,
                        Number(
                          tournament.currentRound ??
                            3,
                        ),
                      ),
                  };
                }

                return competitor;
              }

              /*
               * This golfer missed the Friday cut. Keep the cut state
               * anchored to Round 2 even after the tournament advances.
               */
              return {
                ...competitor,
                status:
                  "cut" as GolfCompetitorStatus,
                currentRound: 2,
              };
            },
          )
        : normalizedCompetitors;

    const normalizationCorrections =
      competitors.filter(
        (competitor, index) => {
          const raw =
            rawCompetitors[index];

          return (
            competitor.status !==
              raw.status ||
            competitor.currentRound !==
              raw.currentRound ||
            competitor.roundsCompleted !==
              raw.roundsCompleted ||
            competitor.holesCompleted !==
              raw.holesCompleted ||
            competitor.leaderboardOrder !==
              raw.leaderboardOrder ||
            competitor.officialScoreToPar !==
              raw.officialScoreToPar
          );
        },
      ).length;

    if (
      normalizationCorrections > 0
    ) {
      console.log(
        "Normalized inconsistent Golf competitor state",
        {
          slateId,
          tournament:
            tournament.name,
          corrections:
            normalizationCorrections,
        },
      );
    }

    if (competitors.length === 0) {
      return NextResponse.json(
        {
          error:
            "ESPN returned the tournament, but the tournament field is not available yet.",
          tournament: {
            eventId: tournament.espnEventId,
            name: tournament.name,
            status: tournament.status,
          },
        },
        { status: 502 },
      );
    }

    const refreshedAt = new Date().toISOString();

    let courseHolesUpserted = 0;

    try {
      /*
       * Course-hole metadata is required independently of the
       * player scoring ingestion path.
       *
       * Always refresh it so new tournaments have all 18 pars
       * and yardages available before golfers play those holes.
       */
      const courses =
        await fetchGolfCoursesByEventId(
          slate.external_event_id ?? "",
        );

      const courseRows = courses.flatMap((course) =>
        course.holes.map((hole) => ({
          slate_id: slateId,
          course_id: course.espnCourseId,
          course_name: course.name,
          is_host: course.isHost,
          hole_number: hole.holeNumber,
          par: hole.par,
          yards: hole.yards,
          updated_at: refreshedAt,
        })),
      );

      if (courseRows.length > 0) {
        const { error: courseDeleteError } =
          await supabaseAdmin
            .from("golf_course_holes")
            .delete()
            .eq("slate_id", slateId);

        if (courseDeleteError) {
          throw new Error(courseDeleteError.message);
        }

        const { error: courseUpsertError } =
          await supabaseAdmin
            .from("golf_course_holes")
            .upsert(courseRows, {
              onConflict:
                "slate_id,course_id,hole_number",
            });

        if (courseUpsertError) {
          throw new Error(courseUpsertError.message);
        }

        courseHolesUpserted = courseRows.length;
      }
    } catch (courseError) {
      console.error(
        "Golf player data will refresh, but course-hole data could not be saved:",
        courseError,
      );
    }
    const penaltyPerRound =
      slate.has_cut
        ? Math.max(0, slate.cut_penalty_per_round ?? 0)
        : 0;

    const golfPlayerRows = competitors.map((competitor) => ({
      espn_player_id: competitor.espnPlayerId,
      display_name: competitor.displayName,
      short_name: competitor.shortName,
      country: competitor.country,
      country_flag_url: competitor.countryFlagUrl,
      player_url: competitor.playerUrl,
      headshot_url:
        `https://a.espncdn.com/i/headshots/golf/players/full/` +
        `${competitor.espnPlayerId}.png`,
      is_active: true,
      updated_at: refreshedAt,
    }));

    function normalizeGolfName(value: string) {
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

    /*
     * Pre-draft field imports may create temporary `pga:*`
     * identities before ESPN publishes its competitor feed.
     *
     * Reconcile those records by normalized name so existing
     * drafted player IDs are preserved instead of creating
     * duplicate ESPN player records.
     */
    const {
      data: existingGolfPlayerData,
      error: existingGolfPlayerError,
    } = await supabaseAdmin
      .from("golf_players")
      .select(
        "id, display_name, espn_player_id",
      );

    if (existingGolfPlayerError) {
      return NextResponse.json(
        {
          error:
            "The tournament field was available, but existing Golf players could not be loaded: " +
            existingGolfPlayerError.message,
        },
        { status: 500 },
      );
    }

    const existingGolfPlayers =
      (existingGolfPlayerData ??
        []) as unknown as GolfPlayerIdRow[];

    const existingByEspnId =
      new Map(
        existingGolfPlayers.map(
          (player) => [
            String(
              player.espn_player_id,
            ),
            player,
          ],
        ),
      );

    const existingByNormalizedName =
      new Map<
        string,
        GolfPlayerIdRow[]
      >();

    for (
      const player of existingGolfPlayers
    ) {
      const normalizedName =
        normalizeGolfName(
          String(
            player.display_name ?? "",
          ),
        );

      if (!normalizedName) {
        continue;
      }

      const rows =
        existingByNormalizedName.get(
          normalizedName,
        ) ?? [];

      rows.push(player);

      existingByNormalizedName.set(
        normalizedName,
        rows,
      );
    }

    const playerIdByEspnId =
      new Map<string, number>();

    const rowsToUpsert:
      typeof golfPlayerRows = [];

    for (
      const competitor of competitors
    ) {
      const existingById =
        existingByEspnId.get(
          competitor.espnPlayerId,
        );

      if (existingById) {
        playerIdByEspnId.set(
          competitor.espnPlayerId,
          Number(existingById.id),
        );

        rowsToUpsert.push(
          golfPlayerRows.find(
            (row) =>
              row.espn_player_id ===
              competitor.espnPlayerId,
          )!,
        );

        continue;
      }

      const nameMatches =
        existingByNormalizedName.get(
          normalizeGolfName(
            competitor.displayName,
          ),
        ) ?? [];

      const syntheticMatch =
        nameMatches.length === 1 &&
        String(
          nameMatches[0]
            .espn_player_id,
        ).startsWith("pga:")
          ? nameMatches[0]
          : null;

      if (syntheticMatch) {
        const {
          error:
            reconciliationError,
        } = await supabaseAdmin
          .from("golf_players")
          .update({
            espn_player_id:
              competitor.espnPlayerId,
            display_name:
              competitor.displayName,
            short_name:
              competitor.shortName,
            country:
              competitor.country,
            country_flag_url:
              competitor.countryFlagUrl,
            player_url:
              competitor.playerUrl,
            headshot_url:
              `https://a.espncdn.com/i/headshots/golf/players/full/` +
              `${competitor.espnPlayerId}.png`,
            is_active: true,
            updated_at:
              refreshedAt,
          })
          .eq(
            "id",
            syntheticMatch.id,
          );

        if (reconciliationError) {
          return NextResponse.json(
            {
              error:
                `Could not reconcile ${competitor.displayName} ` +
                `from PGA TOUR to ESPN: ` +
                reconciliationError.message,
            },
            { status: 500 },
          );
        }

        playerIdByEspnId.set(
          competitor.espnPlayerId,
          Number(
            syntheticMatch.id,
          ),
        );

        continue;
      }

      rowsToUpsert.push(
        golfPlayerRows.find(
          (row) =>
            row.espn_player_id ===
            competitor.espnPlayerId,
        )!,
      );
    }

    let savedPlayers: GolfPlayerIdRow[] =
      [];

    if (rowsToUpsert.length > 0) {
      const {
        data: savedPlayersData,
        error: playersUpsertError,
      } = await supabaseAdmin
        .from("golf_players")
        .upsert(rowsToUpsert, {
          onConflict:
            "espn_player_id",
        })
        .select(
          "id, display_name, espn_player_id",
        );

      if (playersUpsertError) {
        return NextResponse.json(
          {
            error:
              `Failed to save Golf players: ` +
              playersUpsertError.message,
          },
          { status: 500 },
        );
      }

      savedPlayers =
        (savedPlayersData ??
          []) as unknown as GolfPlayerIdRow[];

      for (
        const player of savedPlayers
      ) {
        playerIdByEspnId.set(
          player.espn_player_id,
          Number(player.id),
        );
      }
    }

    const unresolvedCompetitors = competitors.filter(
      (competitor) => !playerIdByEspnId.has(competitor.espnPlayerId),
    );

    if (unresolvedCompetitors.length > 0) {
      return NextResponse.json(
        {
          error:
            "Golf players were saved, but one or more database player IDs could not be resolved.",
          unresolvedPlayers: unresolvedCompetitors.map((competitor) => ({
            espnPlayerId: competitor.espnPlayerId,
            displayName: competitor.displayName,
          })),
        },
        { status: 500 },
      );
    }

    const playerIds = Array.from(
      playerIdByEspnId.values(),
    );

    const {
      data: previousEventPlayerData,
      error: previousEventPlayerError,
    } = playerIds.length > 0
      ? await supabaseAdmin
          .from("golf_event_players")
          .select(
            "id, player_id, rounds_completed, status",
          )
          .eq("slate_id", slateId)
          .in("player_id", playerIds)
      : {
          data: [],
          error: null,
        };

    if (previousEventPlayerError) {
      return NextResponse.json(
        {
          error:
            "Golf players were loaded, but their previous progress could not be read: " +
            previousEventPlayerError.message,
        },
        { status: 500 },
      );
    }

    const previousGolfProgressByPlayerId =
      new Map<
        number,
        {
          roundsCompleted: number;
          status: string | null;
        }
      >(
        (previousEventPlayerData ?? []).map(
          (row) => [
            Number(row.player_id),
            {
              roundsCompleted: Number(
                row.rounds_completed ?? 0,
              ),
              status:
                row.status == null
                  ? null
                  : String(row.status),
            },
          ],
        ),
      );

    /*
     * Snapshot each persisted round BEFORE this refresh writes the
     * current ESPN/PGA scoring state.
     *
     * Golf round-complete notifications should be driven by the actual
     * round transition:
     *
     *   previous holes_completed < 18
     *               ->
     *   current holesCompleted >= 18
     *
     * Do not depend on aggregate rounds_completed or a particular
     * competitor status transition. Those fields can advance on a
     * different refresh than the golfer's final hole.
     */
    const previousEventPlayerIdByPlayerId =
      new Map<number, number>(
        (previousEventPlayerData ?? [])
          .filter(
            (row: any) =>
              Number.isFinite(
                Number(row.id),
              ),
          )
          .map(
            (row: any) => [
              Number(row.player_id),
              Number(row.id),
            ],
          ),
      );

    const previousPlayerIdByEventPlayerId =
      new Map<number, number>(
        Array.from(
          previousEventPlayerIdByPlayerId.entries(),
        ).map(
          ([playerId, eventPlayerId]) => [
            eventPlayerId,
            playerId,
          ],
        ),
      );

    const previousEventPlayerIds =
      Array.from(
        previousPlayerIdByEventPlayerId.keys(),
      );

    const {
      data: previousGolfRoundData,
      error: previousGolfRoundError,
    } =
      previousEventPlayerIds.length > 0
        ? await supabaseAdmin
            .from("golf_rounds")
            .select(
              "event_player_id, round_number, holes_completed",
            )
            .in(
              "event_player_id",
              previousEventPlayerIds,
            )
        : {
            data: [],
            error: null,
          };

    if (previousGolfRoundError) {
      return NextResponse.json(
        {
          error:
            "Golf players were loaded, but their previous round progress could not be read: " +
            previousGolfRoundError.message,
        },
        { status: 500 },
      );
    }

    const previousRoundHolesByPlayerRound =
      new Map<string, number>();

    for (
      const round of
      previousGolfRoundData ?? []
    ) {
      const playerId =
        previousPlayerIdByEventPlayerId.get(
          Number(
            round.event_player_id,
          ),
        );

      if (playerId === undefined) {
        continue;
      }

      previousRoundHolesByPlayerRound.set(
        `${playerId}:${Number(
          round.round_number,
        )}`,
        Number(
          round.holes_completed ?? 0,
        ),
      );
    }

    /*
     * Reconcile the pre-imported PGA field against ESPN's authoritative
     * live competitor list.
     *
     * The PGA field importer intentionally seeds the slate before ESPN
     * publishes live scoring. A late withdrawal can therefore remain in
     * golf_event_players forever if ESPN simply REMOVES that golfer from
     * the live field rather than returning an explicit WD competitor.
     *
     * Only reconcile after the tournament has started, and only golfers
     * with absolutely no tournament activity. This protects us from
     * accidentally changing an active/previously-played golfer if ESPN
     * has a temporary feed issue.
     */
    const currentLivePlayerIds =
      new Set(
        Array.from(
          playerIdByEspnId.values(),
        ).map(Number),
      );

    const {
      data: existingSlateEventData,
      error: existingSlateEventError,
    } =
      await supabaseAdmin
        .from("golf_event_players")
        .select(
          "id, player_id, leaderboard_order, official_score_to_par, official_score_display, penalty_strokes, fantasy_score, rounds_completed, holes_completed, current_round, last_hole, status, tee_time, tee_time_raw",
        )
        .eq("slate_id", slateId);

    if (existingSlateEventError) {
      return NextResponse.json(
        {
          error:
            "Golf live-field reconciliation could not load the existing tournament field: " +
            existingSlateEventError.message,
        },
        { status: 500 },
      );
    }

    const existingSlateRows =
      existingSlateEventData ?? [];

    const existingSlatePlayerIds =
      existingSlateRows.map(
        (row) => Number(row.player_id),
      );

    const {
      data: existingSlateGolfPlayerData,
      error: existingSlateGolfPlayerError,
    } =
      existingSlatePlayerIds.length > 0
        ? await supabaseAdmin
            .from("golf_players")
            .select(
              "id, display_name, espn_player_id",
            )
            .in(
              "id",
              existingSlatePlayerIds,
            )
        : {
            data: [],
            error: null,
          };

    if (existingSlateGolfPlayerError) {
      return NextResponse.json(
        {
          error:
            "Golf live-field reconciliation could not resolve existing golfers: " +
            existingSlateGolfPlayerError.message,
        },
        { status: 500 },
      );
    }

    const existingGolferById =
      new Map(
        (existingSlateGolfPlayerData ?? []).map(
          (player) => [
            Number(player.id),
            {
              displayName:
                String(
                  player.display_name ??
                    "Unknown golfer",
                ),
              espnPlayerId:
                String(
                  player.espn_player_id ??
                    "",
                ),
            },
          ],
        ),
      );

    const alreadyTerminalStatuses =
      new Set([
        "finished",
        "cut",
        "withdrawn",
        "disqualified",
        "did_not_start",
      ]);

    const tournamentHasStarted =
      tournament.status !== "scheduled";

    const removedBeforeStartRows =
      tournamentHasStarted
        ? existingSlateRows.filter(
            (row) => {
              const playerId =
                Number(row.player_id);

              const holesCompleted =
                Number(
                  row.holes_completed ?? 0,
                );

              const roundsCompleted =
                Number(
                  row.rounds_completed ?? 0,
                );

              const status =
                String(
                  row.status ?? "scheduled",
                ).toLowerCase();

              return (
                !currentLivePlayerIds.has(
                  playerId,
                ) &&
                holesCompleted === 0 &&
                roundsCompleted === 0 &&
                !alreadyTerminalStatuses.has(
                  status,
                )
              );
            },
          )
        : [];

    const removedBeforeStartPlayerIds =
      new Set(
        removedBeforeStartRows.map(
          (row) =>
            Number(row.player_id),
        ),
      );

    if (
      removedBeforeStartRows.length > 0
    ) {
      console.log(
        "Golf live-field reconciliation found pre-start removals",
        {
          slateId,
          tournament:
            tournament.name,
          golfers:
            removedBeforeStartRows.map(
              (row) => ({
                playerId:
                  Number(row.player_id),
                name:
                  existingGolferById.get(
                    Number(
                      row.player_id,
                    ),
                  )?.displayName ??
                  "Unknown golfer",
                priorStatus:
                  row.status,
              }),
            ),
        },
      );
    }

    const liveEventPlayerRows =
      competitors.map(
        (competitor) => {
          const penaltyStrokes =
            calculateGolfPenaltyStrokes({
              status:
                competitor.status,
              roundsCompleted:
                competitor.roundsCompleted,
              penaltyPerRound,
            });

          const fantasyScore =
            competitor.officialScoreToPar ===
            null
              ? penaltyStrokes > 0
                ? penaltyStrokes
                : null
              : competitor.officialScoreToPar +
                penaltyStrokes;

          return {
            slate_id: slateId,
            player_id:
              playerIdByEspnId.get(
                competitor.espnPlayerId,
              )!,
            leaderboard_order:
              competitor.leaderboardOrder,
            official_score_to_par:
              competitor.officialScoreToPar,
            official_score_display:
              competitor.officialScoreDisplay,
            penalty_strokes:
              penaltyStrokes,
            fantasy_score:
              fantasyScore,
            rounds_completed:
              competitor.roundsCompleted,
            holes_completed:
              competitor.holesCompleted,
            current_round:
              competitor.currentRound,
            last_hole:
              competitor.lastHole,
            status:
              competitor.status,
            tee_time:
              competitor.teeTime,
            tee_time_raw:
              competitor.teeTimeRaw,
            updated_at:
              refreshedAt,
          };
        },
      );

    const removedBeforeStartEventRows =
      removedBeforeStartRows.map(
        (row) => {
          const penaltyStrokes =
            calculateGolfPenaltyStrokes({
              status: "withdrawn",
              roundsCompleted: 0,
              penaltyPerRound,
            });

          return {
            slate_id: slateId,
            player_id:
              Number(row.player_id),
            leaderboard_order: null,
            official_score_to_par: null,
            official_score_display: null,
            penalty_strokes:
              penaltyStrokes,
            fantasy_score:
              penaltyStrokes > 0
                ? penaltyStrokes
                : null,
            rounds_completed: 0,
            holes_completed: 0,
            current_round: null,
            last_hole: null,
            status:
              "withdrawn" as const,
            tee_time: null,
            tee_time_raw: null,
            updated_at:
              refreshedAt,
          };
        },
      );

    const eventPlayerRows = [
      ...liveEventPlayerRows,
      ...removedBeforeStartEventRows,
    ];

    const { data: eventPlayersData, error: eventPlayersUpsertError } =
      await supabaseAdmin
        .from("golf_event_players")
        .upsert(eventPlayerRows, {
          onConflict: "slate_id,player_id",
        })
        .select("id, player_id");

    if (eventPlayersUpsertError) {
      return NextResponse.json(
        {
          error:
            "Golf players were saved, but the tournament field could not be linked to the slate: " +
            eventPlayersUpsertError.message,
        },
        { status: 500 },
      );
    }

    const eventPlayers = (eventPlayersData ?? []) as GolfEventPlayerIdRow[];

    const eventPlayerIdByPlayerId = new Map(
      eventPlayers.map((eventPlayer) => [
        Number(eventPlayer.player_id),
        Number(eventPlayer.id),
      ]),
    );

    const unresolvedEventPlayers = competitors.filter((competitor) => {
      const playerId = playerIdByEspnId.get(competitor.espnPlayerId);

      return playerId === undefined || !eventPlayerIdByPlayerId.has(playerId);
    });

    if (unresolvedEventPlayers.length > 0) {
      return NextResponse.json(
        {
          error:
            "Tournament players were linked to the slate, but one or more event-player IDs could not be resolved.",
          unresolvedPlayers: unresolvedEventPlayers.map(
            (competitor) => competitor.displayName,
          ),
        },
        { status: 500 },
      );
    }

    /*
     * Persist Golf scoring incrementally.
     *
     * golf_rounds is uniquely keyed by:
     *   event_player_id + round_number
     *
     * golf_holes is uniquely keyed by:
     *   round_id + hole_number
     *
     * Do not delete and reconstruct the scorecard on each refresh.
     * Completed holes already stored in the database remain intact if a
     * later ESPN snapshot is temporarily incomplete.
     */

    /*
     * ESPN remains authoritative for scoring and live round advancement.
     * PGA TOUR is authoritative for the tee sheet it is currently
     * publishing. The PGA parser returns that published round explicitly,
     * so never infer "next round" from ESPN's tournament.currentRound.
     */
    let pgaPublishedRoundNumber:
      number | null = null;

    const pgaTeeTimesByName =
      new Map<
        string,
        {
          raw: string;
          iso: string | null;
        }
      >();

    try {
      const year =
        tournament.startDate
          ? new Date(
              tournament.startDate,
            ).getUTCFullYear()
          : new Date()
              .getUTCFullYear();

      const pgaTournament =
        await resolvePgaTourTournament(
          {
            tournamentName:
              tournament.name,
            year,
          },
        );

      if (pgaTournament) {
        const pgaTeeTimes =
          await fetchPgaTourTeeTimes(
            {
              tournamentUrl:
                pgaTournament
                  .tournamentUrl,
            },
            competitors.map(
              (competitor) =>
                competitor.displayName,
            ),
          );

        pgaPublishedRoundNumber =
          pgaTeeTimes[0]
            ?.roundNumber ??
          null;

        for (const row of pgaTeeTimes) {
          if (
            pgaPublishedRoundNumber !==
              null &&
            row.roundNumber !==
              pgaPublishedRoundNumber
          ) {
            continue;
          }

          pgaTeeTimesByName.set(
            normalizeGolfNameKey(
              row.playerName,
            ),
            {
              raw:
                row.teeTimeRaw,
              iso:
                pgaUtcTeeTimeToIso(
                  {
                    raw:
                      row.teeTimeRaw,
                    tournamentStartDate:
                      tournament.startDate,
                    roundNumber:
                      row.roundNumber,
                  },
                ),
            },
          );
        }

        console.log(
          "PGA TOUR round-aware tee-time reconciliation",
          {
            tournament:
              tournament.name,
            round:
              pgaPublishedRoundNumber,
            pgaTournamentId:
              pgaTournament.tournamentId,
            matched:
              pgaTeeTimesByName.size,
          },
        );
      }
    } catch (error) {
      /*
       * PGA tee-time reconciliation must never break score refresh.
       * ESPN scoring continues normally if PGA is unavailable.
       */
      console.warn(
        "PGA TOUR tee-time reconciliation failed",
        error,
      );
    }

    /*
     * golf_event_players was persisted before the PGA lookup above.
     * Reconcile its scheduling fields only for the exact round PGA says
     * it is publishing. This fixes current-round ESPN timezone errors and
     * still allows a genuinely published future round to advance the
     * scheduling state after the immediately preceding round is complete.
     */
    const pgaTeeTimeEventRows = [];

    if (pgaPublishedRoundNumber !== null) {
      for (const competitor of competitors) {
        const publishedRound =
          competitor.rounds.find(
            (round) =>
              Number(
                round.roundNumber,
              ) ===
              pgaPublishedRoundNumber,
          );

        if (
          !publishedRound ||
          Number(
            publishedRound.holesCompleted ??
              0,
          ) !== 0
        ) {
          continue;
        }

        const pgaTeeTime =
          pgaTeeTimesByName.get(
            normalizeGolfNameKey(
              competitor.displayName,
            ),
          ) ??
          null;

        if (
          !pgaTeeTime?.iso &&
          !pgaTeeTime?.raw
        ) {
          continue;
        }

        const playerId =
          playerIdByEspnId.get(
            competitor.espnPlayerId,
          );

        if (playerId === undefined) {
          continue;
        }

        const eventRow =
          liveEventPlayerRows.find(
            (row) =>
              Number(row.player_id) ===
              Number(playerId),
          );

        if (!eventRow) {
          continue;
        }

        const roundsCompleted =
          Number(
            eventRow.rounds_completed ??
              0,
          );

        const isCurrentScheduledRound =
          Number(
            eventRow.current_round ?? 0,
          ) ===
            pgaPublishedRoundNumber &&
          Number(
            eventRow.holes_completed ?? 0,
          ) === 0;

        const canAdvanceToPublishedRound =
          roundsCompleted ===
            pgaPublishedRoundNumber - 1;

        if (
          !isCurrentScheduledRound &&
          !canAdvanceToPublishedRound
        ) {
          continue;
        }

        eventRow.current_round =
          pgaPublishedRoundNumber;
        eventRow.last_hole = null;
        eventRow.tee_time =
          pgaTeeTime.iso;
        eventRow.tee_time_raw =
          pgaTeeTime.raw;

        if (
          eventRow.status !==
            "round_complete"
        ) {
          eventRow.status =
            "scheduled";
        }

        pgaTeeTimeEventRows.push(
          eventRow,
        );
      }
    }

    if (pgaTeeTimeEventRows.length > 0) {
      const {
        error: pgaEventRowError,
      } =
        await supabaseAdmin
          .from("golf_event_players")
          .upsert(
            pgaTeeTimeEventRows,
            {
              onConflict:
                "slate_id,player_id",
            },
          );

      if (pgaEventRowError) {
        return NextResponse.json(
          {
            error:
              "Golf PGA tee-time state could not be reconciled: " +
              pgaEventRowError.message,
          },
          { status: 500 },
        );
      }
    }

    const roundRows = competitors.flatMap((competitor) => {
      const playerId = playerIdByEspnId.get(competitor.espnPlayerId)!;

      const eventPlayerId = eventPlayerIdByPlayerId.get(playerId)!;

      /*
       * Before play begins, PGA may return the golfer in the
       * tournament field without returning any round objects.
       *
       * Preserve a scheduled round so the scorecard can show
       * all 18 holes and open the pre-round ShotCast layouts.
       * No golf_holes rows are created until real scoring data
       * arrives.
       */
      if (competitor.rounds.length === 0) {
        const scheduledRoundNumber = Math.min(
          4,
          Math.max(
            1,
            Number(
              competitor.currentRound ??
                competitor.roundsCompleted + 1,
            ),
          ),
        );

        return [
          {
            event_player_id: eventPlayerId,
            round_number: scheduledRoundNumber,
            score_to_par: null,
            score_display: null,
            strokes: null,
            holes_completed: 0,
            tee_time:
              scheduledRoundNumber ===
                pgaPublishedRoundNumber
                ? pgaTeeTimesByName.get(
                    normalizeGolfNameKey(
                      competitor.displayName,
                    ),
                  )?.iso ??
                  competitor.teeTime
                : competitor.teeTime,
            tee_time_raw:
              scheduledRoundNumber ===
                pgaPublishedRoundNumber
                ? pgaTeeTimesByName.get(
                    normalizeGolfNameKey(
                      competitor.displayName,
                    ),
                  )?.raw ??
                  competitor.teeTimeRaw
                : competitor.teeTimeRaw,
            status: "scheduled" as const,
            updated_at: refreshedAt,
          },
        ];
      }

      const pgaFallback =
        pgaTeeTimesByName.get(
          normalizeGolfNameKey(
            competitor.displayName,
          ),
        ) ??
        null;

      const persistedRounds =
        competitor.rounds.map(
          (round) => {
            const isPgaPublishedRound =
              pgaPublishedRoundNumber !==
                null &&
              round.roundNumber ===
                pgaPublishedRoundNumber &&
              round.holesCompleted ===
                0;

            return {
              event_player_id:
                eventPlayerId,
              round_number:
                round.roundNumber,
              score_to_par:
                round.scoreToPar,
              score_display:
                round.scoreDisplay,
              strokes:
                round.strokes,
              holes_completed:
                round.holesCompleted,
              tee_time:
                isPgaPublishedRound
                  ? pgaFallback?.iso ??
                    round.teeTime
                  : round.teeTime,
              tee_time_raw:
                isPgaPublishedRound
                  ? pgaFallback?.raw ??
                    round.teeTimeRaw
                  : round.teeTimeRaw,
              status:
                getRoundStatus(
                  round,
                  tournament.status,
                ),
              updated_at:
                refreshedAt,
            };
          },
        );

      const highestProviderRound =
        competitor.rounds.reduce(
          (highest, round) =>
            Math.max(
              highest,
              Number(
                round.roundNumber,
              ),
            ),
          0,
        );

      const upcomingRoundNumber =
        Number(
          competitor.currentRound ?? 0,
        );

      const shouldAddUpcomingRound =
        competitor.status ===
          "scheduled" &&
        upcomingRoundNumber > 0 &&
        upcomingRoundNumber <=
          EXPECTED_TOURNAMENT_ROUNDS &&
        upcomingRoundNumber >
          highestProviderRound;

      if (
        !shouldAddUpcomingRound
      ) {
        return persistedRounds;
      }

      return [
        ...persistedRounds,
        {
          event_player_id:
            eventPlayerId,
          round_number:
            upcomingRoundNumber,
          score_to_par: null,
          score_display: null,
          strokes: null,
          holes_completed: 0,
          tee_time:
            competitor.teeTime ??
            pgaTeeTimesByName.get(
              normalizeGolfNameKey(
                competitor.displayName,
              ),
            )?.iso ??
            null,
          tee_time_raw:
            competitor.teeTimeRaw ??
            pgaTeeTimesByName.get(
              normalizeGolfNameKey(
                competitor.displayName,
              ),
            )?.raw ??
            null,
          status:
            "scheduled" as const,
          updated_at:
            refreshedAt,
        },
      ];
    });

    let savedRounds: GolfRoundIdRow[] = [];

    for (const batch of chunkRows(roundRows, INSERT_BATCH_SIZE)) {
      const { data: insertedRoundsData, error: roundsInsertError } =
        await supabaseAdmin
          .from("golf_rounds")
          .upsert(batch, {
            onConflict:
              "event_player_id,round_number",
          })
          .select("id, event_player_id, round_number");

      if (roundsInsertError) {
        return NextResponse.json(
          {
            error:
              "Golf rounds could not be saved: " + roundsInsertError.message,
          },
          { status: 500 },
        );
      }

      savedRounds = savedRounds.concat(
        (insertedRoundsData ?? []) as GolfRoundIdRow[],
      );
    }

    const roundIdByKey = new Map(
      savedRounds.map((round) => [
        `${round.event_player_id}:${round.round_number}`,
        Number(round.id),
      ]),
    );

    const holeRows = competitors.flatMap((competitor) => {
      const playerId = playerIdByEspnId.get(competitor.espnPlayerId)!;

      const eventPlayerId = eventPlayerIdByPlayerId.get(playerId)!;

      return competitor.rounds.flatMap((round) => {
        const roundId = roundIdByKey.get(
          `${eventPlayerId}:${round.roundNumber}`,
        );

        if (roundId === undefined) {
          return [];
        }

        return round.holes.map((hole) => ({
          round_id: roundId,
          hole_number: hole.holeNumber,
          strokes: hole.strokes,
          relative_to_par: hole.relativeToPar,
          score_display: hole.scoreDisplay,
          updated_at: refreshedAt,
        }));
      });
    });

    /*
     * Upsert the holes present in this ESPN snapshot.
     *
     * Previously completed holes that are absent from a transient
     * snapshot are intentionally left untouched in the database.
     */
    const holesInsertError =
      await upsertInBatches(
        "golf_holes",
        holeRows,
        "round_id,hole_number",
      );

    if (holesInsertError) {
      return NextResponse.json(
        {
          error: "Golf holes could not be saved: " + holesInsertError.message,
        },
        { status: 500 },
      );
    }

    const statusCounts = competitors.reduce<
      Record<GolfCompetitorStatus, number>
    >(
      (counts, competitor) => {
        counts[competitor.status] += 1;
        return counts;
      },
      {
        scheduled: 0,
        active: 0,
        round_complete: 0,
        finished: 0,
        cut: 0,
        withdrawn:
          removedBeforeStartRows.length,
        disqualified: 0,
        did_not_start: 0,
      },
    );

    const { data: lineupsData, error: lineupsError } =
      await supabaseAdmin
        .from("lineups")
        .select(
          `
          id,
          team_id,
          lineup_players (
            player_id
          )
        `,
        )
        .eq("slate_id", slateId);

    if (lineupsError) {
      return NextResponse.json(
        {
          error:
            "Golf data was refreshed, but fantasy lineups could not be loaded: " +
            lineupsError.message,
        },
        { status: 500 },
      );
    }

    let playerFinishedNotifications = {
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    };

    try {
      const newlyCompletedRounds =
        competitors.flatMap(
          (competitor) => {
            const playerId =
              playerIdByEspnId.get(
                competitor.espnPlayerId,
              );

            if (playerId === undefined) {
              return [];
            }

            /*
             * A golfer has newly finished Round N only when the
             * persisted pre-refresh round was incomplete and the
             * current provider round has reached all 18 holes.
             *
             * This is the actual golf event we care about.
             */
            return competitor.rounds.flatMap(
              (round) => {
                const roundNumber =
                  Number(
                    round.roundNumber,
                  );

                const currentHoles =
                  Number(
                    round.holesCompleted ??
                      0,
                  );

                if (
                  !Number.isInteger(
                    roundNumber,
                  ) ||
                  roundNumber < 1 ||
                  roundNumber >
                    EXPECTED_TOURNAMENT_ROUNDS ||
                  currentHoles < 18
                ) {
                  return [];
                }

                const previousHoles =
                  previousRoundHolesByPlayerRound.get(
                    `${playerId}:${roundNumber}`,
                  ) ?? 0;

                if (
                  previousHoles >= 18
                ) {
                  return [];
                }

                return [
                  {
                    playerId,
                    roundNumber,
                    roundScore:
                      round.scoreToPar ??
                      null,
                    fantasyPoints:
                      competitor
                        .officialScoreToPar,
                  },
                ];
              },
            );
          },
        );

      playerFinishedNotifications =
        await notifyNewlyFinishedPlayers({
          slate: {
            id: slate.id,
            date: slate.start_date,
            start_date:
              slate.start_date,
            end_date:
              slate.end_date,
            sport: "golf",
            display_name:
              slate.display_name?.trim() ||
              tournament.name,
          },
          players: competitors.map(
            (competitor) => ({
              id:
                playerIdByEspnId.get(
                  competitor.espnPlayerId,
                )!,
              name:
                competitor.displayName,
            }),
          ),
          lineups:
            (lineupsData ?? []).map(
              (lineup: any) => ({
                team_id:
                  Number(lineup.team_id),
                lineup_players:
                  lineup.lineup_players ??
                  [],
              }),
            ),
          previousStatuses:
            newlyCompletedRounds.map(
              (row) => ({
                playerId:
                  row.playerId,
                gameStatus: 2,
              }),
            ),
          currentStats:
            newlyCompletedRounds.map(
              (row) => ({
                player_id:
                  row.playerId,
                fantasy_points:
                  row.fantasyPoints,
                game_status: 3,
                round_number:
                  row.roundNumber,
                round_score:
                  row.roundScore,
                event_key_suffix:
                  `round-${row.roundNumber}`,
              }),
            ),
        });
    } catch (notificationError) {
      console.error(
        "Golf stats saved, but round-complete notifications failed",
        notificationError,
      );
    }

    const eventRowByPlayerId = new Map(
      eventPlayerRows.map((row) => [
        Number(row.player_id),
        row,
      ]),
    );

    const competitorByPlayerId = new Map(
      competitors.map((competitor) => {
        const playerId = playerIdByEspnId.get(
          competitor.espnPlayerId,
        );

        return [
          Number(playerId),
          competitor,
        ] as const;
      }),
    );

    const { data: slateTeamData, error: slateTeamError } =
      await supabaseAdmin
        .from("slate_teams")
        .select("team_id, draft_order")
        .eq("slate_id", slateId);

    if (slateTeamError) {
      return NextResponse.json(
        {
          error:
            "Golf data was refreshed, but draft-order tiebreak data could not be loaded: " +
            slateTeamError.message,
        },
        { status: 500 },
      );
    }

    const draftOrderByTeamId = new Map(
      (slateTeamData ?? []).map((row) => [
        Number(row.team_id),
        Number(row.draft_order ?? 999),
      ]),
    );

    const teamResultRows = (lineupsData ?? []).map((lineup: any) => {
      const playerIds = (lineup.lineup_players ?? []).map(
        (row: any) => Number(row.player_id),
      );

      const golferRows = playerIds
        .map((playerId: number) => eventRowByPlayerId.get(playerId))
        .filter(Boolean) as typeof eventPlayerRows;

      const fantasyPoints = golferRows.reduce(
        (sum, row) => sum + Number(row.fantasy_score ?? 0),
        0,
      );

      const completedStatuses = new Set([
        "round_complete",
        "finished",
        "cut",
        "withdrawn",
        "disqualified",
      ]);

      const gamesCompleted = golferRows.filter((row) =>
        completedStatuses.has(String(row.status)),
      ).length;

      const gamesInProgress = golferRows.filter(
        (row) => row.status === "active",
      ).length;

      const gamesRemaining = golferRows.filter((row) =>
        ["scheduled", "did_not_start"].includes(String(row.status)),
      ).length;

      const golferCompetitors = playerIds
        .map((playerId: number) =>
          competitorByPlayerId.get(playerId),
        )
        .filter(Boolean);

      const completedIndividualRounds =
        golferCompetitors.flatMap((competitor: any) =>
          (competitor.rounds ?? [])
            .filter(
              (round: any) =>
                Number(round.holesCompleted ?? 0) >= 18 &&
                round.scoreToPar !== null &&
                round.scoreToPar !== undefined,
            )
            .map((round: any) => ({
              roundNumber: Number(round.roundNumber),
              score: Number(round.scoreToPar),
            })),
        );

      const bestIndividualRound =
        completedIndividualRounds.length > 0
          ? Math.min(
              ...completedIndividualRounds.map(
                (round: any) => round.score,
              ),
            )
          : Number.POSITIVE_INFINITY;

      const teamRoundScores: number[] = [];

      for (const roundNumber of [1, 2, 3, 4]) {
        const roundScores = golferCompetitors
          .map((competitor: any) =>
            (competitor.rounds ?? []).find(
              (round: any) =>
                Number(round.roundNumber) === roundNumber &&
                Number(round.holesCompleted ?? 0) >= 18 &&
                round.scoreToPar !== null &&
                round.scoreToPar !== undefined,
            ),
          )
          .filter(Boolean)
          .map((round: any) =>
            Number(round.scoreToPar),
          );

        // A team round counts only after every drafted golfer has
        // completed that round.
        if (
          golferCompetitors.length > 0 &&
          roundScores.length === golferCompetitors.length
        ) {
          teamRoundScores.push(
            roundScores.reduce(
              (sum: number, score: number) =>
                sum + score,
              0,
            ),
          );
        }
      }

      const bestTeamRound =
        teamRoundScores.length > 0
          ? Math.min(...teamRoundScores)
          : Number.POSITIVE_INFINITY;

      const playedHoles =
        golferCompetitors.flatMap((competitor: any) =>
          (competitor.rounds ?? []).flatMap(
            (round: any) => round.holes ?? [],
          ),
        );

      const birdiesOrBetter = playedHoles.filter(
        (hole: any) =>
          hole.relativeToPar !== null &&
          hole.relativeToPar !== undefined &&
          Number(hole.relativeToPar) <= -1,
      ).length;

      const bogeysOrWorse = playedHoles.filter(
        (hole: any) =>
          hole.relativeToPar !== null &&
          hole.relativeToPar !== undefined &&
          Number(hole.relativeToPar) >= 1,
      ).length;

      return {
        slate_id: slateId,
        team_id: Number(lineup.team_id),
        fantasy_points: fantasyPoints,
        finish_position: null as number | null,
        games_completed: gamesCompleted,
        games_in_progress: gamesInProgress,
        games_remaining: gamesRemaining,

        _tiebreak: {
          bestTeamRound,
          bestIndividualRound,
          birdiesOrBetter,
          bogeysOrWorse,
          draftOrder:
            draftOrderByTeamId.get(
              Number(lineup.team_id),
            ) ?? 999,
        },
      };
    });

    const compareGolfTeams = (
      a: (typeof teamResultRows)[number],
      b: (typeof teamResultRows)[number],
    ) => {
      // Lower tournament score wins.
      if (a.fantasy_points !== b.fantasy_points) {
        return a.fantasy_points - b.fantasy_points;
      }

      // 1. Lowest completed team round.
      if (
        a._tiebreak.bestTeamRound !==
        b._tiebreak.bestTeamRound
      ) {
        return (
          a._tiebreak.bestTeamRound -
          b._tiebreak.bestTeamRound
        );
      }

      // 2. Lowest completed individual golfer round.
      if (
        a._tiebreak.bestIndividualRound !==
        b._tiebreak.bestIndividualRound
      ) {
        return (
          a._tiebreak.bestIndividualRound -
          b._tiebreak.bestIndividualRound
        );
      }

      // 3. Most birdies or better.
      if (
        a._tiebreak.birdiesOrBetter !==
        b._tiebreak.birdiesOrBetter
      ) {
        return (
          b._tiebreak.birdiesOrBetter -
          a._tiebreak.birdiesOrBetter
        );
      }

      // 4. Fewest bogeys or worse.
      if (
        a._tiebreak.bogeysOrWorse !==
        b._tiebreak.bogeysOrWorse
      ) {
        return (
          a._tiebreak.bogeysOrWorse -
          b._tiebreak.bogeysOrWorse
        );
      }

      // 5. Earlier draft position guarantees a stable result.
      if (
        a._tiebreak.draftOrder !==
        b._tiebreak.draftOrder
      ) {
        return (
          a._tiebreak.draftOrder -
          b._tiebreak.draftOrder
        );
      }

      return a.team_id - b.team_id;
    };

    const rankedTeamRows =
      [...teamResultRows].sort(compareGolfTeams);

    rankedTeamRows.forEach((row, index) => {
      row.finish_position = index + 1;
    });

    const persistedTeamRows = rankedTeamRows.map(
      ({ _tiebreak, ...row }) => row,
    );

    if (persistedTeamRows.length > 0) {
      const { error: teamResultsError } = await supabaseAdmin
        .from("team_slate_results")
        .upsert(persistedTeamRows, {
          onConflict: "slate_id,team_id",
        });

      if (teamResultsError) {
        return NextResponse.json(
          {
            error:
              "Golf data was refreshed, but fantasy team totals could not be saved: " +
              teamResultsError.message,
          },
          { status: 500 },
        );
      }
    }

    let slateAutoLocked = false;

    let slateCompleteNotifications = {
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    };

    /*
     * A tournament is settled when ESPN explicitly reports Final,
     * or when every golfer is in a terminal state.
     *
     * ESPN commonly leaves golfers who finish Sunday as
     * "round_complete" instead of promoting them to "finished".
     * Treat round_complete as terminal only when that golfer has
     * completed the full four-round / 72-hole tournament.
     *
     * Cut, WD, DQ, and DNS golfers are already terminal states.
     */
    const finalRoundCompleteGolfers =
      competitors.filter(
        (competitor) =>
          competitor.status === "round_complete",
      );

    const allRoundCompleteGolfersAreFinished =
      finalRoundCompleteGolfers.every(
        (competitor) =>
          competitor.roundsCompleted >=
            EXPECTED_TOURNAMENT_ROUNDS &&
          competitor.holesCompleted >=
            EXPECTED_TOURNAMENT_ROUNDS * 18,
      );

    const tournamentFieldIsSettled =
      statusCounts.scheduled === 0 &&
      statusCounts.active === 0 &&
      allRoundCompleteGolfersAreFinished &&
      (
        statusCounts.finished > 0 ||
        finalRoundCompleteGolfers.length > 0
      );

    const tournamentIsComplete =
      tournament.completed ||
      tournament.status === "final" ||
      tournamentFieldIsSettled;

    if (tournamentIsComplete) {
      /*
       * Send notifications before locking. If notification processing
       * throws unexpectedly, leave the slate open so the next cron run
       * can retry instead of permanently losing the final alert.
       *
       * sendLoggedNotification's event keys prevent duplicate pushes.
       */
      try {
        slateCompleteNotifications =
          await notifyCompletedSlate({
            slate: {
              id: slate.id,
              date: slate.start_date,
              start_date:
                slate.start_date,
              end_date:
                slate.end_date,
              sport: "golf",
              display_name:
                slate.display_name?.trim() ||
                tournament.name,
            } as any,
            teamResults:
              persistedTeamRows.map(
                (row) => ({
                  team_id:
                    Number(row.team_id),
                  fantasy_points:
                    Number(
                      row.fantasy_points ?? 0,
                    ),
                  finish_position:
                    row.finish_position,
                }),
              ),
          });
      } catch (notificationError) {
        console.error(
          "Golf tournament is final, but final notifications failed",
          notificationError,
        );

        return NextResponse.json(
          {
            error:
              "Golf results were saved, but final notifications failed. " +
              "The slate was left open so the next refresh can retry.",
            slateId,
          },
          { status: 500 },
        );
      }

      const {
        error: lockError,
      } = await supabaseAdmin
        .from("slates")
        .update({
          is_locked: true,
        })
        .eq("id", slateId)
        .eq("is_locked", false);

      if (lockError) {
        return NextResponse.json(
          {
            error:
              "Golf results and final notifications were saved, " +
              "but the slate could not be locked: " +
              lockError.message,
          },
          { status: 500 },
        );
      }

      slateAutoLocked = true;

      console.log(
        "Golf tournament finalized and slate locked",
        {
          slateId,
          tournament:
            slate.display_name ??
            tournament.name,
          winnerTeamId:
            persistedTeamRows.find(
              (row) =>
                row.finish_position === 1,
            )?.team_id ?? null,
        },
      );
    }

    return NextResponse.json({
      success: true,
      slateId,
      refreshedAt,
      tournament: {
        eventId: tournament.espnEventId,
        name: tournament.name,
        status: tournament.status,
        statusDescription: tournament.statusDescription,
        currentRound: tournament.currentRound,
        completed: tournament.completed,
        startDate: tournament.startDate,
        endDate: tournament.endDate,
      },
      scoring: {
        expectedRounds: EXPECTED_TOURNAMENT_ROUNDS,
        hasCut: slate.has_cut,
        cutPenaltyPerRound: penaltyPerRound,
      },
      statusCounts,
      normalizationCorrections,
      fieldReconciliation: {
        removedBeforeStart:
          removedBeforeStartRows.length,
        playerIds:
          Array.from(
            removedBeforeStartPlayerIds,
          ),
        golfers:
          removedBeforeStartRows.map(
            (row) =>
              existingGolferById.get(
                Number(row.player_id),
              )?.displayName ??
              "Unknown golfer",
          ),
      },
      gamesFound: 1,
      playersUpserted: golfPlayerRows.length,
      eventPlayersUpserted: eventPlayerRows.length,
      playerStatsUpserted: eventPlayerRows.length,
      teamResultsUpserted: persistedTeamRows.length,
      playerFinishedNotifications,
      slateAutoLocked,
      slateCompleteNotifications,
      roundsInserted: roundRows.length,
      holesInserted: holeRows.length,
      courseHolesUpserted,
      preview: competitors.slice(0, 10).map((competitor) => {
        const playerId = playerIdByEspnId.get(competitor.espnPlayerId)!;

        const eventRow = eventPlayerRows.find(
          (row) => row.player_id === playerId,
        );

        return {
          espnPlayerId: competitor.espnPlayerId,
          displayName: competitor.displayName,
          leaderboardOrder: competitor.leaderboardOrder,
          officialScoreDisplay: competitor.officialScoreDisplay,
          roundsCompleted: competitor.roundsCompleted,
          holesCompleted: competitor.holesCompleted,
          status: competitor.status,
          penaltyStrokes: eventRow?.penalty_strokes ?? 0,
          fantasyScore: eventRow?.fantasy_score ?? null,
        };
      }),
    });
  } catch (error) {
    console.error("Unexpected Golf refresh error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error while refreshing Golf data.",
      },
      { status: 500 },
    );
  }
}
