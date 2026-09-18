import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { getCurrentUser } from "@/lib/auth";
import {
  avatarStoragePathFromPublicUrl,
  avatarDisplayStoragePath,
  splitAvatarRetention,
  type AvatarLibraryRecord,
} from "@/lib/profile/avatarLibrary";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const BUCKET_NAME = "profile-images";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const DISPLAY_SIZE = 256;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function getExtension(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function getPublicAvatarUrl(storagePath: string, version?: string | null) {
  const { data } = supabaseAdmin.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
  return `${data.publicUrl}?v=${version ?? Date.now()}`;
}

async function createDisplayAvatar(bytes: Buffer) {
  const optimized = await sharp(bytes, { failOn: "none", limitInputPixels: 16_000_000 })
    .rotate()
    .resize(DISPLAY_SIZE, DISPLAY_SIZE, {
      fit: "cover",
      position: "centre",
      withoutEnlargement: true,
    })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();

  return {
    bytes: optimized,
    contentSha256: createHash("sha256").update(optimized).digest("hex"),
  };
}

async function loadAvatarRecords(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_avatar_images")
    .select("id, user_id, storage_path, content_sha256, mime_type, optimized_storage_path, optimized_content_sha256, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AvatarLibraryRecord[];
}

async function loadCurrentAvatarUrl(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("app_users")
    .select("avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.avatar_url ?? null;
}

async function setCurrentAvatar(userId: string, avatarUrl: string | null) {
  const { error } = await supabaseAdmin
    .from("app_users")
    .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
}

async function lazilyBackfillCurrentAvatar(userId: string, avatarUrl: string | null) {
  const storagePath = avatarStoragePathFromPublicUrl(avatarUrl, userId, BUCKET_NAME);
  if (!storagePath) return;

  const existing = await loadAvatarRecords(userId);
  if (existing.some((record) =>
    record.storage_path === storagePath || record.optimized_storage_path === storagePath,
  )) return;

  const { data: blob, error: downloadError } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .download(storagePath);
  if (downloadError || !blob) {
    console.error("Unable to backfill current avatar history", downloadError);
    return;
  }

  const bytes = Buffer.from(await blob.arrayBuffer());
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const mimeType = ALLOWED_TYPES.has(blob.type) ? blob.type : "image/jpeg";
  const { error: insertError } = await supabaseAdmin.from("user_avatar_images").insert({
    user_id: userId,
    storage_path: storagePath,
    content_sha256: contentSha256,
    mime_type: mimeType,
  });

  // Concurrent reads or an already-retained identical image can win a unique
  // constraint. In either case the canonical current avatar remains valid.
  if (insertError && insertError.code !== "23505") {
    console.error("Unable to backfill current avatar history", insertError);
  }
}

async function cleanupAvatarRetention(userId: string, protectedStoragePath: string | null) {
  const { evicted } = splitAvatarRetention(
    await loadAvatarRecords(userId),
    undefined,
    protectedStoragePath,
  );
  if (evicted.length === 0) return;

  const { error: deleteError } = await supabaseAdmin
    .from("user_avatar_images")
    .delete()
    .eq("user_id", userId)
    .in("id", evicted.map((record) => record.id));
  if (deleteError) {
    console.error("Unable to prune old avatar history", deleteError);
    return;
  }

  const paths = evicted.flatMap((record) =>
    [record.storage_path, record.optimized_storage_path].filter(
      (path): path is string => Boolean(path),
    ),
  );
  const { error: storageError } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .remove(paths);
  // Activation is already complete. A harmless orphan is preferable to
  // rolling back a valid new current avatar.
  if (storageError) console.error("Unable to remove pruned avatar objects", storageError);
}

function serializeAvatarRecords(
  records: AvatarLibraryRecord[],
  currentAvatarUrl: string | null,
  userId: string,
) {
  const currentPath = avatarStoragePathFromPublicUrl(currentAvatarUrl, userId, BUCKET_NAME);
  return records.map((record) => ({
    id: record.id,
    url: getPublicAvatarUrl(
      avatarDisplayStoragePath(record),
      record.optimized_content_sha256 ?? record.content_sha256,
    ),
    createdAt: record.created_at,
    isActive:
      currentPath === record.storage_path ||
      currentPath === record.optimized_storage_path,
  }));
}

async function avatarResponse(userId: string, avatarUrl: string | null) {
  const records = await loadAvatarRecords(userId);
  return {
    success: true,
    avatarUrl,
    avatars: serializeAvatarRecords(records, avatarUrl, userId),
  };
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Login required." }, { status: 401 });

    const avatarUrl = await loadCurrentAvatarUrl(user.id);
    await lazilyBackfillCurrentAvatar(user.id, avatarUrl);
    await cleanupAvatarRetention(
      user.id,
      (await loadAvatarRecords(user.id)).find((record) => {
        const currentPath = avatarStoragePathFromPublicUrl(avatarUrl, user.id, BUCKET_NAME);
        return currentPath === record.storage_path || currentPath === record.optimized_storage_path;
      })?.storage_path ?? null,
    );
    return NextResponse.json(await avatarResponse(user.id, avatarUrl));
  } catch (error) {
    console.error("Profile image history failed", error);
    return NextResponse.json({ error: "Unable to load your recent profile pictures." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Login required." }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Use a JPG, PNG, or WebP image." }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "The image must be 5 MB or smaller." }, { status: 400 });
    }

    const currentAvatarUrl = await loadCurrentAvatarUrl(user.id);
    await lazilyBackfillCurrentAvatar(user.id, currentAvatarUrl);

    const bytes = Buffer.from(await file.arrayBuffer());
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const { data: duplicate, error: duplicateError } = await supabaseAdmin
      .from("user_avatar_images")
      .select("id, storage_path, content_sha256, optimized_storage_path, optimized_content_sha256")
      .eq("user_id", user.id)
      .eq("content_sha256", contentSha256)
      .maybeSingle();
    if (duplicateError) throw duplicateError;

    if (duplicate) {
      const avatarUrl = getPublicAvatarUrl(
        avatarDisplayStoragePath(duplicate),
        duplicate.optimized_content_sha256 ?? duplicate.content_sha256,
      );
      await setCurrentAvatar(user.id, avatarUrl);
      return NextResponse.json(await avatarResponse(user.id, avatarUrl));
    }

    const extension = getExtension(file.type);
    const storagePath = `${user.id}/original/avatar-${Date.now()}-${contentSha256.slice(0, 10)}.${extension}`;
    const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET_NAME).upload(
      storagePath,
      bytes,
      { contentType: file.type, cacheControl: "31536000", upsert: false },
    );
    if (uploadError) {
      console.error("Failed to upload profile image", uploadError);
      return NextResponse.json({ error: `Unable to upload image: ${uploadError.message}` }, { status: 500 });
    }

    let displayAvatar: Awaited<ReturnType<typeof createDisplayAvatar>> | null = null;
    let optimizedStoragePath: string | null = null;
    try {
      displayAvatar = await createDisplayAvatar(bytes);
      optimizedStoragePath = `${user.id}/display/avatar-${contentSha256.slice(0, 16)}.webp`;
      const { error: displayUploadError } = await supabaseAdmin.storage.from(BUCKET_NAME).upload(
        optimizedStoragePath,
        displayAvatar.bytes,
        { contentType: "image/webp", cacheControl: "31536000", upsert: true },
      );
      if (displayUploadError) throw displayUploadError;
    } catch (error) {
      console.error("Unable to optimize profile image; keeping original", error);
      displayAvatar = null;
      optimizedStoragePath = null;
    }

    const { error: insertError } = await supabaseAdmin.from("user_avatar_images").insert({
      user_id: user.id,
      storage_path: storagePath,
      content_sha256: contentSha256,
      mime_type: file.type,
      optimized_storage_path: optimizedStoragePath,
      optimized_content_sha256: displayAvatar?.contentSha256 ?? null,
    });
    if (insertError) {
      const { error: compensationError } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .remove([storagePath, ...(optimizedStoragePath ? [optimizedStoragePath] : [])]);
      if (compensationError) {
        console.error("Unable to remove avatar after history insert failure", compensationError);
      }
      return NextResponse.json({ error: `Unable to save profile image: ${insertError.message}` }, { status: 500 });
    }

    const avatarUrl = getPublicAvatarUrl(
      optimizedStoragePath ?? storagePath,
      displayAvatar?.contentSha256 ?? contentSha256,
    );
    try {
      await setCurrentAvatar(user.id, avatarUrl);
    } catch (error) {
      const { error: rowCleanupError } = await supabaseAdmin
        .from("user_avatar_images")
        .delete()
        .eq("user_id", user.id)
        .eq("storage_path", storagePath);
      const { error: objectCleanupError } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .remove([storagePath, ...(optimizedStoragePath ? [optimizedStoragePath] : [])]);
      if (rowCleanupError || objectCleanupError) {
        console.error("Unable to fully compensate failed avatar activation", {
          rowCleanupError,
          objectCleanupError,
        });
      }
      throw error;
    }

    try {
      await cleanupAvatarRetention(user.id, storagePath);
    } catch (error) {
      console.error("Avatar retention cleanup failed", error);
    }
    return NextResponse.json(await avatarResponse(user.id, avatarUrl));
  } catch (error) {
    console.error("Profile image upload failed", error);
    return NextResponse.json({ error: "Unable to upload your profile picture." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Login required." }, { status: 401 });

    const body = (await request.json()) as { avatarImageId?: unknown };
    if (typeof body.avatarImageId !== "string") {
      return NextResponse.json({ error: "Choose a recent profile picture." }, { status: 400 });
    }

    const { data: avatar, error } = await supabaseAdmin
      .from("user_avatar_images")
      .select("id, storage_path, content_sha256, optimized_storage_path, optimized_content_sha256")
      .eq("id", body.avatarImageId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!avatar) {
      return NextResponse.json({ error: "That profile picture is not available." }, { status: 404 });
    }

    const avatarUrl = getPublicAvatarUrl(
      avatarDisplayStoragePath(avatar),
      avatar.optimized_content_sha256 ?? avatar.content_sha256,
    );
    await setCurrentAvatar(user.id, avatarUrl);
    return NextResponse.json(await avatarResponse(user.id, avatarUrl));
  } catch (error) {
    console.error("Profile image selection failed", error);
    return NextResponse.json({ error: "Unable to select your profile picture." }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Login required." }, { status: 401 });

    await setCurrentAvatar(user.id, null);
    return NextResponse.json(await avatarResponse(user.id, null));
  } catch (error) {
    console.error("Profile image removal failed", error);
    return NextResponse.json({ error: "Unable to remove your profile picture." }, { status: 500 });
  }
}
