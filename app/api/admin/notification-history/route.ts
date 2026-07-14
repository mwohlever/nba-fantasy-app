import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/requireAdminApi";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  const authError = await requireAdminApi();
  if (authError) return authError;

  try {
    const type = request.nextUrl.searchParams.get("type")?.trim() ?? "";
    const status = request.nextUrl.searchParams.get("status")?.trim() ?? "";

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
      .limit(250);

    if (type) query = query.eq("notification_type", type);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: `Failed to load notification history: ${error.message}` },
        { status: 500 }
      );
    }

    const rows = data ?? [];

    const userIds = Array.from(
      new Set(rows.map((row) => row.user_id).filter(Boolean))
    );

    const teamIds = Array.from(
      new Set(rows.map((row) => row.team_id).filter(Boolean))
    );

    const playerIds = Array.from(
      new Set(rows.map((row) => row.player_id).filter(Boolean))
    );

    const slateIds = Array.from(
      new Set(rows.map((row) => row.slate_id).filter(Boolean))
    );

    const [
      { data: users },
      { data: teams },
      { data: players },
      { data: slates },
    ] = await Promise.all([
      userIds.length
        ? supabaseAdmin
            .from("app_users")
            .select("id, display_name")
            .in("id", userIds)
        : Promise.resolve({ data: [] }),
      teamIds.length
        ? supabaseAdmin.from("teams").select("id, name").in("id", teamIds)
        : Promise.resolve({ data: [] }),
      playerIds.length
        ? supabaseAdmin
            .from("players")
            .select("id, name")
            .in("id", playerIds)
        : Promise.resolve({ data: [] }),
      slateIds.length
        ? supabaseAdmin
            .from("slates")
            .select("id, date, start_date, end_date")
            .in("id", slateIds)
        : Promise.resolve({ data: [] }),
    ]);

    const userMap = new Map(
      (users ?? []).map((row) => [String(row.id), row.display_name])
    );

    const teamMap = new Map(
      (teams ?? []).map((row) => [Number(row.id), row.name])
    );

    const playerMap = new Map(
      (players ?? []).map((row) => [Number(row.id), row.name])
    );

    const slateMap = new Map(
      (slates ?? []).map((row) => {
        const startDate = row.start_date ?? row.date;
        const endDate = row.end_date ?? row.date;

        return [
          Number(row.id),
          startDate === endDate
            ? startDate
            : `${startDate} - ${endDate}`,
        ];
      })
    );

    return NextResponse.json({
      success: true,
      history: rows.map((row) => ({
        ...row,
        recipientName: row.user_id
          ? userMap.get(String(row.user_id)) ?? "Unknown user"
          : "No recipient",
        teamName: row.team_id
          ? teamMap.get(Number(row.team_id)) ?? `Team ${row.team_id}`
          : null,
        playerName: row.player_id
          ? playerMap.get(Number(row.player_id)) ??
            `Player ${row.player_id}`
          : null,
        slateLabel: row.slate_id
          ? slateMap.get(Number(row.slate_id)) ?? `Slate ${row.slate_id}`
          : null,
      })),
    });
  } catch (error) {
    console.error("Failed to load notification history", error);

    return NextResponse.json(
      { error: "Unable to load notification history." },
      { status: 500 }
    );
  }
}
