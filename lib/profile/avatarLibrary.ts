export const AVATAR_LIBRARY_LIMIT = 5;

export type AvatarLibraryRecord = {
  id: string;
  user_id: string;
  storage_path: string;
  content_sha256: string;
  mime_type: string;
  created_at: string;
};

export function findAvatarByHash(records: AvatarLibraryRecord[], contentSha256: string) {
  return records.find((record) => record.content_sha256 === contentSha256) ?? null;
}

export function findOwnedAvatar(records: AvatarLibraryRecord[], avatarImageId: string, userId: string) {
  return records.find((record) => record.id === avatarImageId && record.user_id === userId) ?? null;
}

export function splitAvatarRetention(
  records: AvatarLibraryRecord[],
  limit = AVATAR_LIBRARY_LIMIT,
  protectedStoragePath?: string | null,
) {
  const sorted = [...records].sort((left, right) => {
    const byDate = Date.parse(right.created_at) - Date.parse(left.created_at);
    return byDate || right.id.localeCompare(left.id);
  });

  const retained = sorted.slice(0, limit);
  const protectedRecord = protectedStoragePath
    ? sorted.find((record) => record.storage_path === protectedStoragePath)
    : null;

  if (protectedRecord && !retained.includes(protectedRecord)) {
    retained[retained.length - 1] = protectedRecord;
  }

  const retainedIds = new Set(retained.map((record) => record.id));
  return {
    retained,
    evicted: sorted.filter((record) => !retainedIds.has(record.id)),
  };
}

export function avatarStoragePathFromPublicUrl(
  avatarUrl: string | null,
  userId: string,
  bucketName = "profile-images",
) {
  if (!avatarUrl) return null;

  try {
    const url = new URL(avatarUrl);
    const marker = `/storage/v1/object/public/${bucketName}/`;
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const storagePath = decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    return storagePath.startsWith(`${userId}/`) ? storagePath : null;
  } catch {
    return null;
  }
}
