#!/usr/bin/env node

import { createHash } from "node:crypto";
import { config } from "dotenv";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const BUCKET = "golf-headshots";
const SIZE = 128;
const CONCURRENCY = 3;
const PAGE_SIZE = 100;
const PROVIDER_URL = (espnPlayerId) =>
  `https://a.espncdn.com/i/headshots/golf/players/full/${espnPlayerId}.png`;

function parseArguments(argv) {
  const options = { force: false, limit: null };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--force") {
      options.force = true;
      continue;
    }
    if (value === "--limit" && argv[index + 1]) {
      options.limit = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${value}`);
  }

  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer.");
  }
  return options;
}

function isCachedHeadshot(url) {
  return String(url ?? "").includes(`/storage/v1/object/public/${BUCKET}/`);
}

async function fetchProviderHeadshot(espnPlayerId) {
  const response = await fetch(PROVIDER_URL(espnPlayerId), {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`ESPN returned ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function cacheHeadshot(client, golfer) {
  const source = await fetchProviderHeadshot(golfer.espn_player_id);
  const optimized = await sharp(source, { failOn: "none", limitInputPixels: 16_000_000 })
    .rotate()
    .resize(SIZE, SIZE, { fit: "cover", position: "centre", withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  const contentHash = createHash("sha256").update(optimized).digest("hex");
  const storagePath = `espn/${golfer.espn_player_id}.webp`;
  const { error: uploadError } = await client.storage.from(BUCKET).upload(
    storagePath,
    optimized,
    {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: true,
    },
  );
  if (uploadError) throw new Error(`Storage upload: ${uploadError.message}`);

  const { data: publicUrl } = client.storage.from(BUCKET).getPublicUrl(storagePath);
  const headshotUrl = `${publicUrl.publicUrl}?v=${contentHash.slice(0, 12)}`;
  const { error: updateError } = await client
    .from("golf_players")
    .update({ headshot_url: headshotUrl, updated_at: new Date().toISOString() })
    .eq("id", golfer.id);
  if (updateError) throw new Error(`Golf player update: ${updateError.message}`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const counts = { cached: 0, skipped: 0, failed: 0 };
  let offset = 0;
  let processed = 0;

  while (options.limit === null || processed < options.limit) {
    const take = options.limit === null ? PAGE_SIZE : Math.min(PAGE_SIZE, options.limit - processed);
    const { data, error } = await client
      .from("golf_players")
      .select("id, espn_player_id, headshot_url")
      .order("id", { ascending: true })
      .range(offset, offset + take - 1);
    if (error) throw new Error(`Golf player query: ${error.message}`);
    const golfers = data ?? [];
    if (golfers.length === 0) break;
    offset += golfers.length;
    processed += golfers.length;

    const pending = golfers.filter((golfer) => {
      if (!/^\d+$/.test(String(golfer.espn_player_id ?? ""))) {
        counts.skipped += 1;
        return false;
      }
      if (!options.force && isCachedHeadshot(golfer.headshot_url)) {
        counts.skipped += 1;
        return false;
      }
      return true;
    });

    for (let index = 0; index < pending.length; index += CONCURRENCY) {
      await Promise.all(pending.slice(index, index + CONCURRENCY).map(async (golfer) => {
        try {
          await cacheHeadshot(client, golfer);
          counts.cached += 1;
          console.log(`cached ${golfer.id} (${golfer.espn_player_id})`);
        } catch (error) {
          counts.failed += 1;
          console.error(`failed ${golfer.id} (${golfer.espn_player_id}):`, error instanceof Error ? error.message : error);
        }
      }));
    }

    if (golfers.length < take) break;
  }

  console.log(JSON.stringify({ ...counts, size: SIZE, format: "webp", force: options.force }));
  if (counts.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
