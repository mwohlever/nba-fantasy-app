export type RefreshOutcome =
  | { status: "success" }
  | { status: "error"; message: string }
  | { status: "skipped" };
