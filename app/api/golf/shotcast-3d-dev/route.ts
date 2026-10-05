export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DEVELOPMENT / EXPERIMENTAL only: local, hash-checked prepared package handoff. */
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404 });
  const { readDevelopmentAsset } = await import("@/lib/shotcast/developmentAssetResolver.server");
  const query = new URL(request.url).searchParams;
  try {
    const packageId = query.get("package"), assetId = query.get("asset");
    if (packageId || assetId) {
      if (!packageId || !assetId) return new Response(null, { status: 404 });
      const asset = await readDevelopmentAsset(packageId, assetId);
      return asset ? new Response(asset.bytes as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": asset.contentType, "Cache-Control": "no-store" } }) : new Response(null, { status: 404 });
    }
    // Identity alone cannot supply player coordinates. Preparation uses POST below.
    return Response.json(null, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Missing, ambiguous, corrupt, or changed local inputs leave the 2D map usable.
    return query.has("package") || query.has("asset")
      ? new Response(null, { status: 404 })
      : Response.json(null, { headers: { "Cache-Control": "no-store" } });
  }
}

/** Read-only preparation of the replay already fetched by the current hole panel. */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404 });
  const { resolveDevelopmentShotcast } = await import("@/lib/shotcast/developmentAssetResolver.server");
  try {
    const result = await resolveDevelopmentShotcast(await request.json());
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(null, { headers: { "Cache-Control": "no-store" } });
  }
}
