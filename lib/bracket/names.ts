export function bracketDisplayLabel(bracketNumber: number, name: string | null | undefined) {
  const trimmed = name?.trim();
  return trimmed || `Bracket ${bracketNumber}`;
}

export function normalizeBracketName(value: unknown): string | null {
  if (typeof value !== "string") throw new Error("Bracket name must be text.");
  const name = value.trim();
  if (name.length > 80) throw new Error("Bracket name must be at most 80 characters.");
  return name || null;
}
