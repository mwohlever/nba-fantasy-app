import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const DRAFT_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
  "https://nba-fantasy-app-omega.vercel.app";

type SlateTeamRow = {
  team_id: number;
  draft_order: number;
  is_participating: boolean;
  teams?: {
    name: string;
  } | null;
};

async function sendSms(to: string, body: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    console.log("SMS skipped. Missing Twilio env vars.", { to, body });
    return { skipped: true };
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        From: from,
        Body: body,
      }),
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Failed to send SMS.");
  }

  return result;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const slateId = Number(body?.slateId);

    if (!slateId) {
      return NextResponse.json(
        { error: "slateId is required." },
        { status: 400 }
      );
    }

    const { data: slate, error: slateError } = await supabaseAdmin
      .from("slates")
      .select("id, sms_enabled")
      .eq("id", slateId)
      .single();

    if (slateError || !slate) {
      return NextResponse.json(
        { error: slateError?.message || "Slate not found." },
        { status: 500 }
      );
    }

    if (!slate.sms_enabled) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "SMS is disabled for this slate.",
      });
    }

    const { data: slateTeams, error: slateTeamsError } = await supabaseAdmin
      .from("slate_teams")
      .select("team_id, draft_order, is_participating, teams(name)")
      .eq("slate_id", slateId)
      .eq("is_participating", true)
      .order("draft_order", { ascending: true });

    if (slateTeamsError) {
      return NextResponse.json(
        { error: slateTeamsError.message },
        { status: 500 }
      );
    }

    const orderedTeams = (slateTeams ?? [])
  .map((t: any) => ({
    team_id: t.team_id,
    draft_order: t.draft_order,
    is_participating: t.is_participating,
    teams: t.teams ?? null,
  }))
  .sort((a, b) => Number(a.draft_order) - Number(b.draft_order));

    if (orderedTeams.length === 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "No participating teams found.",
      });
    }

    const { data: lineups, error: lineupsError } = await supabaseAdmin
      .from("lineups")
      .select("id, team_id, lineup_players(player_id)")
      .eq("slate_id", slateId);

    if (lineupsError) {
      return NextResponse.json(
        { error: lineupsError.message },
        { status: 500 }
      );
    }

    const totalDrafted =
      lineups?.reduce((sum, lineup: any) => {
        return sum + Number(lineup.lineup_players?.length ?? 0);
      }, 0) ?? 0;

    const totalTeams = orderedTeams.length;
    const maxPicks = totalTeams * 5;

    if (totalDrafted >= maxPicks) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "Draft is complete.",
      });
    }

    const roundIndex = Math.floor(totalDrafted / totalTeams);
    const pickInRound = totalDrafted % totalTeams;

    const nextTeam =
      roundIndex % 2 === 0
        ? orderedTeams[pickInRound]
        : orderedTeams[totalTeams - 1 - pickInRound];

    const { data: contact, error: contactError } = await supabaseAdmin
      .from("team_contacts")
      .select("team_id, name, phone, sms_enabled")
      .eq("team_id", nextTeam.team_id)
      .maybeSingle();

    if (contactError) {
      return NextResponse.json(
        { error: contactError.message },
        { status: 500 }
      );
    }

    if (!contact || !contact.sms_enabled) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "Next team contact missing or disabled.",
        nextTeam,
      });
    }

    const teamName = nextTeam.teams?.name ?? contact.name;
    const message = `111 Fantasy: ${teamName}, you're up to draft. ${DRAFT_URL}/lineups/draft`;

    const smsResult = await sendSms(contact.phone, message);

    return NextResponse.json({
      success: true,
      nextTeam: {
        teamId: nextTeam.team_id,
        teamName,
        draftOrder: nextTeam.draft_order,
      },
      contact: {
        name: contact.name,
        phone: contact.phone,
      },
      smsResult,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected SMS error." },
      { status: 500 }
    );
  }
}
