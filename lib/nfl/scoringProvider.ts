import { fetchNflScoringSchedule, fetchNflScoringSummary, type EspnScoreboardEvent, type EspnGameSummary } from "@/lib/providers/nfl";

export class NflScoringProvider {
  private schedules = new Map<string, Promise<EspnScoreboardEvent[]>>();
  private summaries = new Map<string, Promise<EspnGameSummary>>();
  scoreboardMs = 0;
  summaryMs = 0;
  summariesFetched = 0;

  schedule(start: string, end: string) {
    const key = `${start}:${end}`;
    if (!this.schedules.has(key)) {
      this.schedules.set(key, (async () => {
        const began = performance.now();
        try { return await fetchNflScoringSchedule(start.replaceAll("-", ""), end.replaceAll("-", "")); }
        finally { this.scoreboardMs += performance.now() - began; }
      })());
    }
    return this.schedules.get(key)!;
  }

  summary(eventId: string) {
    if (!this.summaries.has(eventId)) {
      this.summaries.set(eventId, (async () => {
        const began = performance.now();
        this.summariesFetched++;
        try { return await fetchNflScoringSummary(eventId); }
        finally { this.summaryMs += performance.now() - began; }
      })());
    }
    return this.summaries.get(eventId)!;
  }
}
