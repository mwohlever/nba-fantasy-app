#!/usr/bin/env node

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  SPORTS_HEADSHOT_CONFIG,
  SPORTS_HEADSHOT_SIZE,
  cacheSportsHeadshots,
} from "./lib/sportsHeadshotCache.js";

config({ path: ".env.local" });

const PAGE_SIZE = 100;

function parseArguments(argv) {
  const options = { sport: null, force: false, limit: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--sport" && argv[index + 1]) {
      options.sport = argv[index + 1];
      index += 1;
    } else if (value === "--force") options.force = true;
    else if (value === "--limit" && argv[index + 1]) {
      options.limit = Number(argv[index + 1]);
      index += 1;
    } else throw new Error(`Unknown option: ${value}`);
  }
  if (!Object.hasOwn(SPORTS_HEADSHOT_CONFIG, options.sport)) throw new Error("--sport nba or --sport nfl is required.");
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer.");
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const configForSport = SPORTS_HEADSHOT_CONFIG[options.sport];
  const counts = { cached: 0, skipped: 0, failed: 0 };
  let offset = 0;
  let processed = 0;
  while (options.limit === null || processed < options.limit) {
    const take = options.limit === null ? PAGE_SIZE : Math.min(PAGE_SIZE, options.limit - processed);
    const { data, error } = await client.from(configForSport.table)
      .select(`id, ${configForSport.idColumn}, headshot_url`)
      .order("id", { ascending: true })
      .range(offset, offset + take - 1);
    if (error) throw new Error(`Player query: ${error.message}`);
    const players = data ?? [];
    if (!players.length) break;
    offset += players.length;
    processed += players.length;
    const pageCounts = await cacheSportsHeadshots({
      client,
      sport: options.sport,
      players,
      force: options.force,
      onCached: (player) => console.log(`cached ${player.id} (${player[configForSport.idColumn]})`),
      onFailed: (player, error) => console.error(`failed ${player.id} (${player[configForSport.idColumn]}):`, error instanceof Error ? error.message : error),
    });
    counts.cached += pageCounts.cached;
    counts.skipped += pageCounts.skipped;
    counts.failed += pageCounts.failed;
    if (players.length < take) break;
  }
  console.log(JSON.stringify({ sport: options.sport, ...counts, size: SPORTS_HEADSHOT_SIZE, format: "webp", force: options.force }));
  if (counts.failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
