/** Active-Group commissioners/super-admins, plus the existing legacy proxy role. */
export function canProxyDraftForGroup(
  context: { canAdministerGroup?: boolean } | null | undefined,
  user: { role?: string },
): boolean {
  return Boolean(context && (context.canAdministerGroup || user.role === "admin"));
}
