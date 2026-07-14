import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const BUCKET_NAME = "profile-images";
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function getExtension(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

async function removeExistingAvatarFiles(userId: string) {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .list(userId, {
      limit: 100,
    });

  if (error) {
    console.error("Failed to list existing avatar files", error);
    return;
  }

  const paths = (data ?? []).map((file) => `${userId}/${file.name}`);

  if (paths.length === 0) return;

  const { error: removeError } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .remove(paths);

  if (removeError) {
    console.error("Failed to remove old avatar files", removeError);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Choose an image to upload." },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Use a JPG, PNG, or WebP image." },
        { status: 400 }
      );
    }

    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "The image must be 5 MB or smaller." },
        { status: 400 }
      );
    }

    await removeExistingAvatarFiles(user.id);

    const extension = getExtension(file.type);
    const storagePath = `${user.id}/avatar-${Date.now()}.${extension}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(storagePath, bytes, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("Failed to upload profile image", uploadError);

      return NextResponse.json(
        { error: `Unable to upload image: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from(BUCKET_NAME)
      .getPublicUrl(storagePath);

    const avatarUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { error: updateError } = await supabaseAdmin
      .from("app_users")
      .update({
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateError) {
      await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .remove([storagePath]);

      return NextResponse.json(
        { error: `Unable to save profile image: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      avatarUrl,
    });
  } catch (error) {
    console.error("Profile image upload failed", error);

    return NextResponse.json(
      { error: "Unable to upload your profile picture." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401 }
      );
    }

    await removeExistingAvatarFiles(user.id);

    const { error } = await supabaseAdmin
      .from("app_users")
      .update({
        avatar_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (error) {
      return NextResponse.json(
        { error: `Unable to remove profile image: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      avatarUrl: null,
    });
  } catch (error) {
    console.error("Profile image removal failed", error);

    return NextResponse.json(
      { error: "Unable to remove your profile picture." },
      { status: 500 }
    );
  }
}
