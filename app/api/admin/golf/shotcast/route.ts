// Retired endpoint: no authentication, provider calls, or database access.
export function GET() {
  return Response.json(
    { error: "ShotCast has been discontinued." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

export function POST() {
  return Response.json(
    { error: "ShotCast has been discontinued." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
