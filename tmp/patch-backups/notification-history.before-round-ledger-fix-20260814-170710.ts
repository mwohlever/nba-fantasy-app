import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/requireAdminApi";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SportKey = "nba" | "nfl" | "golf";

function normalizeSport(value: unknown): SportKey {
  if (value === "nfl") return "nfl";
  if (value === "golf") return "golf";
  return "nba";
}

function validIsoDateTime(value: string) {
  if (!value) return null;

  const parsed = new Date(value);

  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : null;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminApi();
  if (authError) return authError;

  try {
    const type =
      request.nextUrl.searchParams.get("type")?.trim() ?? "";

    const status =
      request.nextUrl.searchParams.get("status")?.trim() ?? "";

    const sport =
      request.nextUrl.searchParams.get("sport")?.trim() ?? "";

    const start =
      validIsoDateTime(
        request.nextUrl.searchParams.get("start")?.trim() ?? ""
      );

    const end =
      validIsoDateTime(
        request.nextUrl.searchParams.get("end")?.trim() ?? ""
      );

    let sportSlateIds: number[] | null = null;

    if (sport && sport !== "all") {
      const normalizedSport = normalizeSport(sport);

      const { data: sportSlates, error: sportSlatesError } =
        await supabaseAdmin
          .from("slates")
          .select("id")
          .eq("sport", normalizedSport);

      if (sportSlatesError) {
        return NextResponse.json(
          {
            error:
              `Failed to filter by sport: ` +
              sportSlatesError.message,
          },
          { status: 500 }
        );
      }

      sportSlateIds = (sportSlates ?? []).map((row) =>
        Number(row.id)
      );
    }

    let query = supabaseAdmin
      .from("notification_history")
      .select(
        `
          id,
          event_key,
          notification_type,
          user_id,
          team_id,
          slate_id,
          player_id,
          title,
          body,
          status,
          sent_count,
          failed_count,
          skipped,
          reason,
          metadata,
          created_at,
          completed_at
        `
      )
      .order("created_at", { ascending: false })
      .limit(1000);

    if (type) {
      query = query.eq("notification_type", type);
    }

    if (start) {
      query = query.gte("created_at", start);
    }

    if (end) {
      query = query.lt("created_at", end);
    }

    if (sportSlateIds !== null) {
      query =
        sportSlateIds.length > 0
          ? query.in("slate_id", sportSlateIds)
          : query.is("slate_id", null);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        {
          error:
            `Failed to load notification history: ` +
            error.message,
        },
        { status: 500 }
      );
    }

    const rows = data ?? [];

    const userIds = Array.from(
      new Set(
        rows
          .map((row) => row.user_id)
          .filter(Boolean)
          .map(String)
      )
    );

    const teamIds = Array.from(
      new Set(
        rows
          .map((row) => row.team_id)
          .filter(Boolean)
          .map(Number)
      )
    );

    const slateIds = Array.from(
      new Set(
        rows
          .map((row) => row.slate_id)
          .filter(Boolean)
          .map(Number)
      )
    );

    const [
      { data: users },
      { data: teams },
      { data: slates },
    ] = await Promise.all([
      userIds.length
        ? supabaseAdmin
            .from("app_users")
            .select("id, display_name")
            .in("id", userIds)
        : Promise.resolve({ data: [] }),

      teamIds.length
        ? supabaseAdmin
            .from("teams")
            .select("id, name")
            .in("id", teamIds)
        : Promise.resolve({ data: [] }),

      slateIds.length
        ? supabaseAdmin
            .from("slates")
            .select(
              "id, date, start_date, end_date, sport, display_name"
            )
            .in("id", slateIds)
        : Promise.resolve({ data: [] }),
    ]);

    const userMap = new Map(
      (users ?? []).map((row) => [
        String(row.id),
        row.display_name,
      ])
    );

    const teamMap = new Map(
      (teams ?? []).map((row) => [
        Number(row.id),
        row.name,
      ])
    );

    const slateSportMap = new Map<number, SportKey>(
      (slates ?? []).map((row) => [
        Number(row.id),
        normalizeSport(row.sport),
      ])
    );

    const slateMap = new Map(
      (slates ?? []).map((row) => {
        const startDate = row.start_date ?? row.date;
        const endDate = row.end_date ?? row.date;

        const dateLabel =
          startDate === endDate
            ? startDate
            : `${startDate} - ${endDate}`;

        return [
          Number(row.id),
          row.display_name?.trim() || dateLabel,
        ];
      })
    );

    const nbaPlayerIds = new Set<number>();
    const nflPlayerIds = new Set<number>();
    const golfPlayerIds = new Set<number>();

    for (const row of rows) {
      if (!row.player_id) continue;

      const rowSport = row.slate_id
        ? slateSportMap.get(Number(row.slate_id)) ?? "nba"
        : "nba";

      const playerId = Number(row.player_id);

      if (rowSport === "nfl") {
        nflPlayerIds.add(playerId);
      } else if (rowSport === "golf") {
        golfPlayerIds.add(playerId);
      } else {
        nbaPlayerIds.add(playerId);
      }
    }

    const [
      { data: nbaPlayers },
      { data: nflPlayers },
      { data: golfPlayers },
    ] = await Promise.all([
      nbaPlayerIds.size
        ? supabaseAdmin
            .from("players")
            .select("id, name")
            .in("id", [...nbaPlayerIds])
        : Promise.resolve({ data: [] }),

      nflPlayerIds.size
        ? supabaseAdmin
            .from("players_nfl")
            .select("id, name")
            .in("id", [...nflPlayerIds])
        : Promise.resolve({ data: [] }),

      golfPlayerIds.size
        ? supabaseAdmin
            .from("golf_players")
            .select("id, display_name")
            .in("id", [...golfPlayerIds])
        : Promise.resolve({ data: [] }),
    ]);

    const nbaPlayerMap = new Map(
      (nbaPlayers ?? []).map((row) => [
        Number(row.id),
        row.name,
      ])
    );

    const nflPlayerMap = new Map(
      (nflPlayers ?? []).map((row) => [
        Number(row.id),
        row.name,
      ])
    );

    const golfPlayerMap = new Map(
      (golfPlayers ?? []).map((row) => [
        Number(row.id),
        row.display_name,
      ])
    );

    function resolvePlayerName(
      row: (typeof rows)[number]
    ) {
      if (!row.player_id) return null;

      const rowSport = row.slate_id
        ? slateSportMap.get(Number(row.slate_id)) ?? "nba"
        : "nba";

      const playerId = Number(row.player_id);

      if (rowSport === "golf") {
        return (
          golfPlayerMap.get(playerId) ??
          `Golfer ${playerId}`
        );
      }

      if (rowSport === "nfl") {
        return (
          nflPlayerMap.get(playerId) ??
          `Player ${playerId}`
        );
      }

      return (
        nbaPlayerMap.get(playerId) ??
        `Player ${playerId}`
      );
    }


    /*
     * Expected Golf notification ledger.
     *
     * notification_history only contains events that actually reached
     * sendLoggedNotification(). For Golf round-complete notifications we
     * also want to see events that SHOULD exist before delivery.
     *
     * Expected event key:
     *   player_finished:<slateId>:<playerId>:round-<roundNumber>
     *
     * If a matching notification_history row exists, that real delivery
     * row remains authoritative. Otherwise:
     *
     *   incomplete round -> waiting
     *   completed round  -> missed
     *
     * This is intentionally monitoring-only. It does not send pushes,
     * modify notification preferences, or alter the live completion
     * trigger.
     */
    type ExpectedLedgerRow = {
      id: string;
      event_key: string;
      notification_type: string;
      user_id: string | null;
      team_id: number | null;
      slate_id: number | null;
      player_id: number | null;
      title: string;
      body: string;
      status: "waiting" | "missed";
      sent_count: number;
      failed_count: number;
      skipped: boolean;
      reason: string | null;
      metadata: Record<string, unknown>;
      created_at: string;
      completed_at: string | null;
      sport: SportKey | null;
      recipientName: string;
      teamName: string | null;
      playerName: string | null;
      slateLabel: string | null;
    };

    const realEventKeys = new Set(
      rows
        .map((row) => row.event_key)
        .filter(Boolean)
        .map(String)
    );

    const expectedLedgerRows: ExpectedLedgerRow[] = [];

    /*
     * Only synthesize Golf expectations when Golf is included in the
     * selected filter. NBA/NFL can adopt the same ledger model later
     * without changing their current monitor behavior today.
     */
    if (!sport || sport === "all" || sport === "golf") {
      const { data: golfSlates, error: golfSlatesError } =
        await supabaseAdmin
          .from("slates")
          .select(
            "id, date, start_date, end_date, sport, display_name"
          )
          .eq("sport", "golf");

      if (golfSlatesError) {
        return NextResponse.json(
          {
            error:
              "Failed to build expected Golf notifications: " +
              golfSlatesError.message,
          },
          { status: 500 }
        );
      }

      const relevantGolfSlates = (golfSlates ?? []).filter((slate) => {
        const rawStartDate =
          slate.start_date ??
          slate.date;

        if (!rawStartDate) return false;

        const rawEndDate =
          slate.end_date ??
          slate.date ??
          rawStartDate;

        /*
         * A Golf tournament spans multiple calendar days.
         *
         * Include the slate whenever its date range overlaps the
         * Notification Monitor's selected day:
         *
         *   slateEnd >= rangeStart
         *   slateStart < rangeEnd
         *
         * Do NOT require the tournament itself to start on the selected
         * day; Round 2/3/4 naturally occur after start_date.
         */
        const slateStart =
          new Date(`${rawStartDate}T00:00:00Z`);

        const slateEnd =
          new Date(`${rawEndDate}T23:59:59.999Z`);

        if (
          start &&
          slateEnd < new Date(start)
        ) {
          return false;
        }

        if (
          end &&
          slateStart >= new Date(end)
        ) {
          return false;
        }

        return true;
      });

      const golfSlateIds =
        relevantGolfSlates.map((slate) =>
          Number(slate.id)
        );

      if (golfSlateIds.length > 0) {
        /*
         * Visible notification history is filtered to the selected day,
         * but deduplication/reconciliation must use the entire tournament
         * history. Otherwise a Round 1 notification sent yesterday would
         * incorrectly appear MISSED while viewing Round 2 today.
         */
        const {
          data: tournamentNotificationHistory,
          error: tournamentNotificationHistoryError,
        } = await supabaseAdmin
          .from("notification_history")
          .select("event_key")
          .in("slate_id", golfSlateIds)
          .eq("notification_type", "player_finished")
          .not("event_key", "is", null);

        if (tournamentNotificationHistoryError) {
          return NextResponse.json(
            {
              error:
                "Failed to reconcile expected Golf notifications: " +
                tournamentNotificationHistoryError.message,
            },
            { status: 500 }
          );
        }

        for (
          const row of tournamentNotificationHistory ?? []
        ) {
          if (row.event_key) {
            realEventKeys.add(
              String(row.event_key)
            );
          }
        }

        const [
          { data: golfLineups, error: golfLineupsError },
          { data: eventPlayers, error: eventPlayersError },
        ] = await Promise.all([
          supabaseAdmin
            .from("lineups")
            .select(
              `
                id,
                slate_id,
                team_id,
                lineup_players (
                  player_id
                )
              `
            )
            .in("slate_id", golfSlateIds),

          supabaseAdmin
            .from("golf_event_players")
            .select(
              `
                id,
                slate_id,
                player_id,
                current_round,
                rounds_completed,
                status
              `
            )
            .in("slate_id", golfSlateIds),
        ]);

        if (golfLineupsError) {
          return NextResponse.json(
            {
              error:
                "Failed to build expected Golf notifications from lineups: " +
                golfLineupsError.message,
            },
            { status: 500 }
          );
        }

        if (eventPlayersError) {
          return NextResponse.json(
            {
              error:
                "Failed to build expected Golf notifications from event players: " +
                eventPlayersError.message,
            },
            { status: 500 }
          );
        }

        const safeGolfLineups =
          (golfLineups ?? []) as Array<{
            id: number;
            slate_id: number;
            team_id: number;
            lineup_players:
              | Array<{ player_id: number }>
              | null;
          }>;

        const safeEventPlayers =
          (eventPlayers ?? []) as Array<{
            id: number;
            slate_id: number;
            player_id: number;
            current_round: number | null;
            rounds_completed: number | null;
            status: string | null;
          }>;

        const eventPlayerIds =
          safeEventPlayers.map((row) =>
            Number(row.id)
          );

        const { data: golfRounds, error: golfRoundsError } =
          eventPlayerIds.length > 0
            ? await supabaseAdmin
                .from("golf_rounds")
                .select(
                  "event_player_id, round_number, holes_completed"
                )
                .in("event_player_id", eventPlayerIds)
            : { data: [], error: null };

        if (golfRoundsError) {
          return NextResponse.json(
            {
              error:
                "Failed to build expected Golf notifications from rounds: " +
                golfRoundsError.message,
            },
            { status: 500 }
          );
        }

        const teamIdsForLedger = Array.from(
          new Set(
            safeGolfLineups.map((row) =>
              Number(row.team_id)
            )
          )
        );

        const { data: ledgerUsers, error: ledgerUsersError } =
          teamIdsForLedger.length > 0
            ? await supabaseAdmin
                .from("app_users")
                .select(
                  "id, team_id, display_name"
                )
                .in(
                  "team_id",
                  teamIdsForLedger
                )
                .eq("is_active", true)
            : { data: [], error: null };

        if (ledgerUsersError) {
          return NextResponse.json(
            {
              error:
                "Failed to build expected Golf notifications from users: " +
                ledgerUsersError.message,
            },
            { status: 500 }
          );
        }

        const ledgerUserIds =
          (ledgerUsers ?? []).map((row) =>
            String(row.id)
          );

        const { data: ledgerPreferences } =
          ledgerUserIds.length > 0
            ? await supabaseAdmin
                .from("notification_preferences")
                .select(
                  "user_id, notifications_enabled, player_finished_enabled"
                )
                .in(
                  "user_id",
                  ledgerUserIds
                )
            : { data: [] };

        const ledgerUserByTeamId =
          new Map(
            (ledgerUsers ?? []).map((row) => [
              Number(row.team_id),
              row,
            ])
          );

        const ledgerPreferenceByUserId =
          new Map(
            (ledgerPreferences ?? []).map((row) => [
              String(row.user_id),
              row,
            ])
          );

        const ledgerSlateById =
          new Map(
            relevantGolfSlates.map((slate) => [
              Number(slate.id),
              slate,
            ])
          );

        const ledgerEventPlayerBySlatePlayer =
          new Map(
            safeEventPlayers.map((row) => [
              `${Number(row.slate_id)}:${Number(row.player_id)}`,
              row,
            ])
          );

        const ledgerRoundsByEventPlayer =
          new Map<
            number,
            Array<{
              round_number: number;
              holes_completed: number | null;
            }>
          >();

        for (const round of golfRounds ?? []) {
          const eventPlayerId =
            Number(round.event_player_id);

          const existing =
            ledgerRoundsByEventPlayer.get(
              eventPlayerId
            ) ?? [];

          existing.push({
            round_number:
              Number(round.round_number),
            holes_completed:
              round.holes_completed === null
                ? null
                : Number(round.holes_completed),
          });

          ledgerRoundsByEventPlayer.set(
            eventPlayerId,
            existing
          );
        }

        /*
         * Expected Golf notification rounds are determined per golfer.
         *
         * Golfers do not all complete a round at the same time. Using
         * the field-wide maximum rounds_completed advances every golfer
         * to the next round as soon as the first golfer finishes.
         *
         * Instead, each golfer's own rounds_completed determines the
         * round whose completion notification should currently exist.
         */

        const ledgerPlayerIds =
          Array.from(
            new Set(
              safeGolfLineups.flatMap((lineup) =>
                (lineup.lineup_players ?? []).map(
                  (row) => Number(row.player_id)
                )
              )
            )
          );

        const { data: ledgerGolfPlayers } =
          ledgerPlayerIds.length > 0
            ? await supabaseAdmin
                .from("golf_players")
                .select("id, display_name")
                .in("id", ledgerPlayerIds)
            : { data: [] };

        const ledgerPlayerNameById =
          new Map(
            (ledgerGolfPlayers ?? []).map((row) => [
              Number(row.id),
              String(row.display_name),
            ])
          );

        for (const lineup of safeGolfLineups) {
          const slateId =
            Number(lineup.slate_id);

          const teamId =
            Number(lineup.team_id);

          const slate =
            ledgerSlateById.get(slateId);

          if (!slate) continue;

          const user =
            ledgerUserByTeamId.get(teamId) ??
            null;

          const preference =
            user
              ? ledgerPreferenceByUserId.get(
                  String(user.id)
                ) ?? null
              : null;

          /*
           * Do not create expected rows for users who have explicitly
           * disabled player-finished notifications. The monitor should
           * represent notifications the system is actually expected to
           * deliver.
           *
           * Missing preference rows use the app default: enabled.
           */
          if (
            preference &&
            (
              preference.notifications_enabled === false ||
              preference.player_finished_enabled === false
            )
          ) {
            continue;
          }

          const slateLabel =
            String(
              slate.display_name?.trim() ||
                slate.start_date ||
                slate.date ||
                `Slate ${slateId}`
            );

          const expectedCreatedAt =
            `${String(
              slate.start_date ??
                slate.date
            )}T00:00:00.000Z`;

          for (
            const lineupPlayer of
              lineup.lineup_players ?? []
          ) {
            const playerId =
              Number(
                lineupPlayer.player_id
              );

            const eventPlayer =
              ledgerEventPlayerBySlatePlayer.get(
                `${slateId}:${playerId}`
              );

            if (!eventPlayer) {
              continue;
            }

            const rounds =
              ledgerRoundsByEventPlayer.get(
                Number(eventPlayer.id)
              ) ?? [];

            const roundsCompleted =
              Number(
                eventPlayer.rounds_completed ?? 0
              );

            const roundNumber =
              Math.min(
                4,
                Math.max(
                  1,
                  roundsCompleted + 1
                )
              );

            /*
             * Do not show tomorrow's expected notification
             * immediately after today's round is completed.
             *
             * Example:
             *   rounds_completed = 2
             *   current_round = 2
             *
             * Round 2 is done, but Round 3 has not started yet.
             * The Round 3 WAITING row appears only after the live
             * provider advances this golfer to current_round = 3.
             */
            const currentRound =
              Number(
                eventPlayer.current_round ??
                  0
              );

            if (
              roundsCompleted > 0 &&
              currentRound <= roundsCompleted
            ) {
              continue;
            }

            const eventKey =
              `player_finished:${slateId}:${playerId}:round-${roundNumber}`;

            /*
             * If the delivery pipeline already processed this exact
             * current-round event, the real notification_history row is
             * authoritative and no synthetic row is needed.
             */
            if (
              realEventKeys.has(eventKey)
            ) {
              continue;
            }

            const persistedRound =
              rounds.find(
                (round) =>
                  Number(
                    round.round_number
                  ) === roundNumber
              ) ?? null;

            /*
             * A current-round notification becomes MISSED only after
             * that exact round is genuinely complete.
             *
             * Future placeholder round rows do not matter.
             */
            const roundComplete =
              Number(
                eventPlayer.rounds_completed ??
                  0
              ) >= roundNumber ||
              Number(
                persistedRound
                  ?.holes_completed ?? 0
              ) >= 18;

            const playerName =
              ledgerPlayerNameById.get(
                playerId
              ) ??
              `Golfer ${playerId}`;

            expectedLedgerRows.push({
              id:
                `expected:${eventKey}`,
              event_key:
                eventKey,
              notification_type:
                "player_finished",
              user_id:
                user
                  ? String(user.id)
                  : null,
              team_id:
                teamId,
              slate_id:
                slateId,
              player_id:
                playerId,
              title:
                `⛳ ${playerName} finished!`,
              body:
                roundComplete
                  ? `${playerName} completed Round ${roundNumber}, but no notification event was recorded.`
                  : `Waiting for ${playerName} to complete Round ${roundNumber}.`,
              status:
                roundComplete
                  ? "missed"
                  : "waiting",
              sent_count: 0,
              failed_count: 0,
              skipped: false,
              reason:
                roundComplete
                  ? `Round ${roundNumber} is complete, but no matching notification event reached the delivery pipeline.`
                  : `Waiting for Round ${roundNumber} completion.`,
              metadata: {
                expected: true,
                roundNumber,
                roundsCompleted,
                playerStatus:
                  eventPlayer.status ??
                  null,
                holesCompleted:
                  persistedRound
                    ?.holes_completed ??
                  null,
                devices: [],
              },
              created_at:
                expectedCreatedAt,
              completed_at:
                roundComplete
                  ? new Date().toISOString()
                  : null,
              sport:
                "golf",
              recipientName:
                user?.display_name ??
                "No recipient",
              teamName:
                teamMap.get(teamId) ??
                `Team ${teamId}`,
              playerName,
              slateLabel,
            });
          }
        }
      }
    }

    const history = rows.map((row) => {
      const rowSport = row.slate_id
        ? slateSportMap.get(Number(row.slate_id)) ?? "nba"
        : null;

      return {
        ...row,
        sport: rowSport,
        recipientName: row.user_id
          ? userMap.get(String(row.user_id)) ??
            "Unknown user"
          : "No recipient",
        teamName: row.team_id
          ? teamMap.get(Number(row.team_id)) ??
            `Team ${row.team_id}`
          : null,
        playerName: resolvePlayerName(row),
        slateLabel: row.slate_id
          ? slateMap.get(Number(row.slate_id)) ??
            `Slate ${row.slate_id}`
          : null,
      };
    });

    const combinedHistory = [
      ...history,
      ...expectedLedgerRows,
    ].sort(
      (a, b) =>
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime()
    );

    const filteredHistory =
      status
        ? combinedHistory.filter(
            (row) =>
              row.status === status
          )
        : combinedHistory;

    const summary = {
      total: combinedHistory.length,
      sent: combinedHistory.filter(
        (row) => row.status === "sent"
      ).length,
      partial: combinedHistory.filter(
        (row) => row.status === "partial"
      ).length,
      failed: combinedHistory.filter(
        (row) => row.status === "failed"
      ).length,
      skipped: combinedHistory.filter(
        (row) => row.status === "skipped"
      ).length,
      pending: combinedHistory.filter(
        (row) => row.status === "pending"
      ).length,
      waiting: combinedHistory.filter(
        (row) => row.status === "waiting"
      ).length,
      missed: combinedHistory.filter(
        (row) => row.status === "missed"
      ).length,
      devicesSent: combinedHistory.reduce(
        (sum, row) =>
          sum + Number(row.sent_count ?? 0),
        0
      ),
      devicesFailed: combinedHistory.reduce(
        (sum, row) =>
          sum + Number(row.failed_count ?? 0),
        0
      ),
    };

    return NextResponse.json({
      success: true,
      history: filteredHistory,
      summary,
      range: {
        start,
        end,
      },
    });
  } catch (error) {
    console.error(
      "Failed to load notification history",
      error
    );

    return NextResponse.json(
      {
        error: "Unable to load notification history.",
      },
      { status: 500 }
    );
  }
}
