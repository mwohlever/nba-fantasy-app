#!/usr/bin/env node

import { createHash } from "node:crypto";
import { config } from "dotenv";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const BUCKET = "profile-images";
const SIZE = 256;
const CONCURRENCY = 3;
const PAGE_SIZE = 100;

function parseArguments(argv) {
  const options = { force: false, limit: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--force") options.force = true;
    else if (value === "--limit" && argv[index + 1]) {
      options.limit = Number(argv[index + 1]);
      index += 1;
    } else throw new Error(`Unknown option: ${value}`);
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer.");
  }
  return options;
}

function storagePathFromPublicUrl(url, userId) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const index = parsed.pathname.indexOf(marker);
    if (index < 0) return null;
    const path = decodeURIComponent(parsed.pathname.slice(index + marker.length));
    return path.startsWith(`${userId}/`) ? path : null;
  } catch {
    return null;
  }
}

function publicUrl(client, storagePath, version) {
  const { data } = client.storage.from(BUCKET).getPublicUrl(storagePath);
  return `${data.publicUrl}?v=${version.slice(0, 12)}`;
}

async function ensureAvatarRecord(client, user, currentPath) {
  const { data, error } = await client
    .from("user_avatar_images")
    .select("id, user_id, storage_path, content_sha256, mime_type, optimized_storage_path, optimized_content_sha256")
    .eq("user_id", user.id);
  if (error) throw new Error(`Avatar record query: ${error.message}`);
  const records = data ?? [];
  const existing = records.find((record) =>
    record.storage_path === currentPath || record.optimized_storage_path === currentPath,
  );
  if (existing) return existing;

  const { data: blob, error: downloadError } = await client.storage.from(BUCKET).download(currentPath);
  if (downloadError || !blob) throw new Error(`Original download: ${downloadError?.message ?? "missing"}`);
  const bytes = Buffer.from(await blob.arrayBuffer());
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const mimeType = ["image/jpeg", "image/png", "image/webp"].includes(blob.type) ? blob.type : "image/jpeg";
  const { data: inserted, error: insertError } = await client
    .from("user_avatar_images")
    .insert({ user_id: user.id, storage_path: currentPath, content_sha256: contentSha256, mime_type: mimeType })
    .select("id, user_id, storage_path, content_sha256, mime_type, optimized_storage_path, optimized_content_sha256")
    .single();
  if (insertError) throw new Error(`Avatar record insert: ${insertError.message}`);
  return inserted;
}

async function cacheAvatar(client, user, options) {
  const currentPath = storagePathFromPublicUrl(user.avatar_url, user.id);
  if (!currentPath) return "skipped";
  const record = await ensureAvatarRecord(client, user, currentPath);
  if (!options.force && record.optimized_storage_path && record.optimized_content_sha256) {
    const optimizedUrl = publicUrl(client, record.optimized_storage_path, record.optimized_content_sha256);
    if (user.avatar_url !== optimizedUrl) {
      const { error } = await client.from("app_users").update({ avatar_url: optimizedUrl, updated_at: new Date().toISOString() }).eq("id", user.id);
      if (error) throw new Error(`Avatar activation: ${error.message}`);
    }
    return "skipped";
  }

  const { data: blob, error: downloadError } = await client.storage.from(BUCKET).download(record.storage_path);
  if (downloadError || !blob) throw new Error(`Original download: ${downloadError?.message ?? "missing"}`);
  const source = Buffer.from(await blob.arrayBuffer());
  const optimized = await sharp(source, { failOn: "none", limitInputPixels: 16_000_000 })
    .rotate()
    .resize(SIZE, SIZE, { fit: "cover", position: "centre", withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  const optimizedHash = createHash("sha256").update(optimized).digest("hex");
  const displayPath = `${user.id}/display/avatar-${record.content_sha256.slice(0, 16)}.webp`;
  const { error: uploadError } = await client.storage.from(BUCKET).upload(displayPath, optimized, {
    contentType: "image/webp", cacheControl: "31536000", upsert: true,
  });
  if (uploadError) throw new Error(`Display upload: ${uploadError.message}`);

  const { error: recordError } = await client
    .from("user_avatar_images")
    .update({ optimized_storage_path: displayPath, optimized_content_sha256: optimizedHash })
    .eq("id", record.id);
  if (recordError) throw new Error(`Avatar record update: ${recordError.message}`);
  const { error: activationError } = await client
    .from("app_users")
    .update({ avatar_url: publicUrl(client, displayPath, optimizedHash), updated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (activationError) throw new Error(`Avatar activation: ${activationError.message}`);
  return "cached";
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const counts = { cached: 0, skipped: 0, failed: 0 };
  let offset = 0;
  let processed = 0;
  while (options.limit === null || processed < options.limit) {
    const take = options.limit === null ? PAGE_SIZE : Math.min(PAGE_SIZE, options.limit - processed);
    const { data, error } = await client.from("app_users").select("id, avatar_url").not("avatar_url", "is", null).order("id").range(offset, offset + take - 1);
    if (error) throw new Error(`User query: ${error.message}`);
    const users = data ?? [];
    if (!users.length) break;
    offset += users.length;
    processed += users.length;
    for (let index = 0; index < users.length; index += CONCURRENCY) {
      await Promise.all(users.slice(index, index + CONCURRENCY).map(async (user) => {
        try {
          const result = await cacheAvatar(client, user, options);
          counts[result] += 1;
          if (result === "cached") console.log(`cached ${user.id}`);
        } catch (error) {
          counts.failed += 1;
          console.error(`failed ${user.id}:`, error instanceof Error ? error.message : error);
        }
      }));
    }
    if (users.length < take) break;
  }
  console.log(JSON.stringify({ ...counts, size: SIZE, format: "webp", force: options.force }));
  if (counts.failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
