import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "../auth";
import { getActiveLeagueForSport } from "../groups/context";
import { authorizeSlateResource } from "../security/resourceAuthorization";
import { supabaseAdmin } from "../supabaseAdmin";
import { PlayerCenterService } from "./service";
import { SupabaseCenterRepository } from "./repository.server";
import { playerCenterEnabled } from "./feature";
import { validCenterSeason, type CenterPhase, type CenterScoringContext, type CenterWindow } from "./types";

const service = new PlayerCenterService(new SupabaseCenterRepository());
const headers = { "Cache-Control": "private, no-store, max-age=0" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const positiveId = (value: string | null) => value !== null && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

export async function playerCenterGet(request: Request, mode: "profile" | "comparisons") {
  if (!playerCenterEnabled()) return reply({ error: "Player Center is not enabled." }, 404);
  try {
    const user = await getCurrentUser();
    if (!user) return reply({ error: "Login required." }, 401);
    const params = new URL(request.url).searchParams, sport = params.get("sport");
    if (sport !== "nba" && sport !== "nfl") return reply({ error: "sport must be nba or nfl." }, 400);
    const active = await getActiveLeagueForSport(user, sport);
    if (!active) return reply({ error: "This sport is not enabled for the active Group." }, 404);
    const season = Number(params.get("season")), phase = params.get("phase") ?? "regular";
    if (!validCenterSeason(season, sport) || !["regular", "preseason", "postseason"].includes(phase)) return reply({ error: "A valid professional season and phase are required." }, 400);
    let scoring: CenterScoringContext = { sport, basis: "league_settings", settings: active.league.settings };
    const slateParam = params.get("slateId");
    if (slateParam !== null) {
      const slateId = positiveId(slateParam);
      if (!slateId) return reply({ error: "Invalid slateId." }, 400);
      const authorized = await authorizeSlateResource(request, slateId, { expectedSport: sport });
      if (!authorized.ok) return authorized.response;
      if (authorized.target.groupId !== active.context.group.id || authorized.target.leagueId !== active.league.id) return reply({ error: "Slate not found." }, 404);
      const result = await supabaseAdmin.from("slates").select("rules_snapshot").eq("id", slateId).eq("league_id", active.league.id).maybeSingle();
      if (result.error) return reply({ error: "Unable to read slate rules." }, 503);
      if (!result.data) return reply({ error: "Slate not found." }, 404);
      const snapshot: unknown = result.data.rules_snapshot;
      if (snapshot !== null && (typeof snapshot !== "object" || Array.isArray(snapshot))) return reply({ error: "Invalid frozen rules snapshot." }, 503);
      // Intentional legacy fallback is canonical defaults, never today's changed league settings.
      scoring = { sport, basis: snapshot === null ? "legacy_defaults" : "slate_snapshot", settings: snapshot as Record<string, unknown> | null };
    }
    const scope = { groupId: active.context.group.id, leagueId: active.league.id };
    if (mode === "profile") {
      const playerId = positiveId(params.get("playerId"));
      if (!playerId) return reply({ error: "A valid playerId is required." }, 400);
      const result = await service.profile({ sport, playerId, season, phase: phase as CenterPhase, scoring });
      return result ? reply({ ...scope, ...result }) : reply({ error: "Player not found." }, 404);
    }
    const window = params.get("window") ?? "last5", metric = params.get("metric") ?? "fantasy_points", direction = params.get("direction") ?? "desc";
    const position = params.get("position") ?? undefined;
    if (phase !== "regular" || !["last1", "last3", "last5", "season"].includes(window) || !["asc", "desc"].includes(direction) ||
      position && !(sport === "nba" ? ["G", "F/C", "UTIL"] : ["QB", "RB", "WR", "TE", "K", "D/ST"]).includes(position)) return reply({ error: "Invalid comparison window, phase, position, or direction." }, 400);
    const result = await service.comparisons({ sport, season, window: window as CenterWindow, metric, position, ascending: direction === "asc", scoring });
    return reply({ ...scope, ...result });
  } catch (error) {
    if (error instanceof Error && error.message === "Unsupported comparison metric") return reply({ error: error.message }, 400);
    console.error("Player Center read failed", error instanceof Error ? error.message : "unknown");
    return reply({ error: "Player Center data is temporarily unavailable." }, 503);
  }
}
