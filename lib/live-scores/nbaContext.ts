/** The basketball provider is shared; only app access and ownership differ. */
export type NbaLiveContext = "nba" | "nba-skins";

export function nbaLiveContext(value: string | null): NbaLiveContext {
  return value === "nba-skins" ? "nba-skins" : "nba";
}

export function nbaLiveContextQuery(context: NbaLiveContext) {
  return context === "nba-skins" ? "&context=nba-skins" : "";
}
