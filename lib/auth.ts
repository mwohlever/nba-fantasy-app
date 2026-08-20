import {
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const scrypt = promisify(nodeScrypt);

export const SESSION_COOKIE_NAME = "nba_fantasy_session";
const SESSION_LENGTH_DAYS = 90;

export type AppUser = {
  id: string;

  /*
   * Legacy runtime identity.
   *
   * Keep these fields while the existing application is
   * migrated sport-by-sport to Group-scoped identities.
   */
  teamId: number;
  role: "player" | "admin";

  displayName: string;
  avatarUrl: string | null;

  /*
   * Modern authentication identity.
   *
   * Nullable during the Groups beta while existing PIN accounts
   * are explicitly linked to Supabase Auth.
   */
  email: string | null;
  authUserId: string | null;

  /*
   * New account-level permission model.
   */
  systemRole:
    | "user"
    | "super_admin";
};

type AppUserRow = {
  id: string;
  team_id: number;
  display_name: string;
  role: "player" | "admin";
  system_role:
    | "user"
    | "super_admin";
  pin_salt: string;
  pin_hash: string;
  is_active: boolean;
  avatar_url: string | null;
  email: string | null;
  auth_user_id: string | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  expires_at: string;
  app_users: AppUserRow | AppUserRow[] | null;
};

export function generatePinSalt() {
  return randomBytes(16).toString("hex");
}

export async function hashPin(pin: string, salt: string) {
  const derivedKey = (await scrypt(pin, salt, 64)) as Buffer;
  return derivedKey.toString("hex");
}

export async function verifyPin(
  pin: string,
  salt: string,
  expectedHash: string
) {
  const actualHash = await hashPin(pin, salt);

  const actualBuffer = Buffer.from(actualHash, "hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createUserSession(userId: string) {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(rawToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_LENGTH_DAYS);

  const { error } = await supabaseAdmin.from("user_sessions").insert({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    throw new Error(`Failed to create session: ${error.message}`);
  }

  const cookieStore = await cookies();

  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: rawToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteCurrentSession() {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (rawToken) {
    await supabaseAdmin
      .from("user_sessions")
      .delete()
      .eq("token_hash", hashSessionToken(rawToken));
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function deleteOtherUserSessions(userId: string) {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!rawToken) {
    throw new Error("Current session could not be identified.");
  }

  const currentTokenHash = hashSessionToken(rawToken);

  const { error } = await supabaseAdmin
    .from("user_sessions")
    .delete()
    .eq("user_id", userId)
    .neq("token_hash", currentTokenHash);

  if (error) {
    throw new Error(`Failed to remove other sessions: ${error.message}`);
  }
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);

  const { data, error } = await supabaseAdmin
    .from("user_sessions")
    .select(
      `
        id,
        user_id,
        expires_at,
        app_users (
          id,
          team_id,
          display_name,
          role,
          system_role,
          pin_salt,
          pin_hash,
          is_active,
          avatar_url,
          email,
          auth_user_id
        )
      `
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return null;

  const session = data as unknown as SessionRow;

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await supabaseAdmin
      .from("user_sessions")
      .delete()
      .eq("id", session.id);

    cookieStore.delete(SESSION_COOKIE_NAME);
    return null;
  }

  const relatedUser = Array.isArray(session.app_users)
    ? session.app_users[0]
    : session.app_users;

  if (!relatedUser?.is_active) return null;

  void supabaseAdmin
    .from("user_sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", session.id);

  return {
    id: relatedUser.id,
    teamId: Number(relatedUser.team_id),
    displayName: relatedUser.display_name,
    role: relatedUser.role,
    avatarUrl: relatedUser.avatar_url ?? null,

    email:
      relatedUser.email ??
      null,

    authUserId:
      relatedUser.auth_user_id ??
      null,

    systemRole:
      relatedUser.system_role ??
      "user",
  };
}


/*
 * Transitional compatibility helper.
 *
 * Existing server pages and API routes still call requireAdmin().
 * Make that helper understand the new Groups permission model now,
 * without forcing every route to migrate in the same patch.
 */
export async function requireAdmin() {
  const user =
    await getCurrentUser();

  if (!user) {
    return null;
  }

  if (
    user.systemRole ===
    "super_admin"
  ) {
    return user;
  }

  const {
    getGroupContextForUser,
  } =
    await import(
      "@/lib/groups/context"
    );

  const context =
    await getGroupContextForUser(
      user,
    );

  if (
    !context?.isGroupAdmin
  ) {
    return null;
  }

  return user;
}
