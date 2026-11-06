import { playerCenterGet } from "@/lib/player-center/http.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function GET(request: Request) { return playerCenterGet(request, "profile"); }
