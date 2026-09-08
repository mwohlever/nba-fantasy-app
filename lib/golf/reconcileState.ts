import { acceptGolfHole, golfScoreDisplay, summarizeGolfHoles, type HoleObservation } from "./holeAcceptance";
import { calculateGolfPenaltyStrokes } from "../scoring/golf";
import { calculateGolfTeamResults } from "./teamResults";

// Database-shaped records keep this boundary independent of either provider's payload shape.
export type GolfRecord = Record<string, any>;
export type GolfObservationBatch = {
  observedAt: string;
  events?: GolfRecord[];
  rounds?: GolfRecord[];
  holes: Array<HoleObservation & { round_id: number }>;
};
export type GolfAcceptedState = {
  slateId: number;
  events: GolfRecord[];
  lineups: GolfRecord[];
  slateTeams: GolfRecord[];
  teams: GolfRecord[];
  penaltyPerRound: number;
};
const terminal = new Set(["finished", "cut", "withdrawn", "disqualified", "did_not_start"]);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const differs = (before: GolfRecord, patch: GolfRecord) => Object.keys(patch).some(k => !equal(before[k] ?? null, patch[k] ?? null));

/** Pure state transition used by both refresh and replay, and future scheduled ingestion. */
export function reconcileGolfState(state: GolfAcceptedState, batch: GolfObservationBatch, revision: number) {
  const events = structuredClone(state.events);
  const holeWrites: GolfRecord[] = [], roundWrites: GolfRecord[] = [], eventWrites: GolfRecord[] = [];
  let scoringChanged = false;
  for (const event of events) {
    const eventInput = batch.events?.find(e => Number(e.player_id) === Number(event.player_id));
    const oldEvent = structuredClone(event);
    const rounds = event.golf_rounds ?? [];
    const oldRoundScore = rounds.reduce((s: number,r: GolfRecord) => s + Number(r.score_to_par ?? 0), 0);
    const oldTotalHoles = rounds.reduce((s: number, r: GolfRecord) => s + Number(r.holes_completed ?? 0), 0);
    const oldCompletedRounds = rounds.filter((r: GolfRecord) => r.holes_completed >= 18).length;
    let roundChanged = false;
    let retractedHole = false;
    for (const round of rounds) {
      const before = structuredClone(round);
      const incoming = batch.rounds?.find(r => Number(r.event_player_id) === Number(event.id) && r.round_number === round.round_number);
      const observations = batch.holes.filter(h => Number(h.round_id) === Number(round.id));
      const beforeHoles = summarizeGolfHoles(round.golf_holes ?? []);
      const coverage = observations.filter(h => h.reconciliation.source === "espn" && h.strokes != null && h.relative_to_par != null);
      const sum = summarizeGolfHoles(coverage);
      const officialValidated = !!incoming && coverage.length > 0 &&
        new Set(coverage.map(h => h.hole_number)).size === coverage.length &&
        coverage.length >= Number(round.holes_completed ?? 0) &&
        coverage.length === incoming.holes_completed &&
        coverage.every(h => h.reconciliation.source === "espn" && acceptGolfHole(undefined, h)) &&
        sum.strokes === incoming.strokes && sum.score_to_par === incoming.score_to_par;
      let changedHole = false;
      for (const observation of observations) {
        const candidate = structuredClone(observation);
        if (candidate.reconciliation.source === "espn" && candidate.reconciliation.operation !== "retract") {
          candidate.reconciliation.officialValidated = officialValidated;
        }
        const current = (round.golf_holes ?? []).find((h: GolfRecord) => h.hole_number === candidate.hole_number);
        if (!acceptGolfHole(current, candidate)) continue;
        const retract = candidate.reconciliation.operation === "retract";
        const patch = {
          round_id: round.id, hole_number: candidate.hole_number,
          strokes: retract ? null : candidate.strokes,
          relative_to_par: retract ? null : candidate.relative_to_par,
          score_display: golfScoreDisplay(retract ? null : candidate.relative_to_par),
          reconciliation: candidate.reconciliation,
        };
        const valueChanged = !current || current.strokes !== patch.strokes || current.relative_to_par !== patch.relative_to_par;
        holeWrites.push(patch);
        if (current) Object.assign(current, patch);
        else (round.golf_holes ??= []).push(patch);
        changedHole ||= valueChanged;
        retractedHole ||= retract && valueChanged;
      }
      const newerRound = incoming && Date.parse(batch.observedAt) > Date.parse(round.reconciliation?.observedAt ?? "1970-01-01");
      if (newerRound) {
        // Tee metadata is independent of scoring coverage. Null tee values never erase known times.
        for (const key of ["tee_time", "tee_time_raw"]) if (incoming[key] != null) round[key] = incoming[key];
        // Preserve aggregate-only historical rounds until a card with equal coverage is available.
        if (!round.golf_holes?.length && incoming.holes_completed >= round.holes_completed && incoming.score_to_par != null) {
          for (const key of ["strokes", "score_to_par", "score_display", "holes_completed", "status"]) round[key] = incoming[key];
        }
        round.reconciliation = { ...round.reconciliation, observedAt: batch.observedAt, source: "espn" };
      }
      const summary = summarizeGolfHoles(round.golf_holes ?? []);
      if (changedHole || (newerRound && officialValidated)) {
        // A partial historical card does not identify which absent holes contributed to
        // its aggregate. Keep that aggregate until coverage catches up; adding its
        // "remainder" to newly discovered holes would count those holes twice.
        const legacy = before.reconciliation?.legacyAggregate ?? (before.holes_completed > beforeHoles.holes_completed ? {
          holes_completed: before.holes_completed,
          strokes: before.strokes,
          score_to_par: before.score_to_par,
        } : null);
        Object.assign(round, summary);
        if (legacy && summary.holes_completed < legacy.holes_completed) {
          const updated = { ...legacy };
          for (const priorHole of before.golf_holes ?? []) {
            const accepted = round.golf_holes.find((h: GolfRecord) => h.hole_number === priorHole.hole_number);
            if (priorHole.strokes != null && accepted) {
              updated.strokes = Number(updated.strokes ?? 0) + Number(accepted.strokes ?? 0) - priorHole.strokes;
              updated.score_to_par = Number(updated.score_to_par ?? 0) + Number(accepted.relative_to_par ?? 0) - Number(priorHole.relative_to_par ?? 0);
              if (accepted.strokes == null) updated.holes_completed -= 1;
            }
          }
          Object.assign(round, updated);
          round.reconciliation = { ...round.reconciliation, legacyAggregate: updated };
        } else if (round.reconciliation?.legacyAggregate) {
          delete round.reconciliation.legacyAggregate;
        }
        round.score_display = golfScoreDisplay(round.score_to_par);
        round.status = round.holes_completed >= 18 ? "finished" : round.holes_completed > 0 ? "active" : "scheduled";
      }
      const patch: GolfRecord = { id: round.id };
      for (const key of ["strokes", "score_to_par", "score_display", "holes_completed", "status", "tee_time", "tee_time_raw", "reconciliation"]) patch[key] = round[key] ?? null;
      const roundScoreChanged = ["strokes", "score_to_par", "holes_completed", "status"].some(k => before[k] !== round[k]);
      roundChanged ||= roundScoreChanged || changedHole;
      if (differs(before, patch) || changedHole) {
        // Provenance-only confirmations do not invalidate clients or rewrite results.
        round.accepted_revision = roundScoreChanged || changedHole ? revision : Number(before.accepted_revision ?? 0);
        roundWrites.push({ ...patch, accepted_revision: round.accepted_revision });
      }
    }
    const newerEvent = eventInput && Date.parse(batch.observedAt) > Date.parse(event.reconciliation?.observedAt ?? "1970-01-01");
    if (newerEvent) {
      for (const key of ["leaderboard_order", "tee_time", "tee_time_raw"]) if (eventInput[key] != null) event[key] = eventInput[key];
      // An incomplete refresh cannot move progress backward or unfinish a terminal golfer.
      if (eventInput.holes_completed >= oldEvent.holes_completed) {
        for (const key of ["status", "current_round", "last_hole"]) {
          if (key !== "status" || !terminal.has(event.status) || terminal.has(eventInput.status)) event[key] = eventInput[key];
        }
      }
      event.reconciliation = { ...event.reconciliation, observedAt: batch.observedAt, source: "espn" };
    }
    const totalHoles = rounds.reduce((s: number,r: GolfRecord) => s + Number(r.holes_completed ?? 0), 0);
    const totalScore = rounds.reduce((s: number,r: GolfRecord) => s + Number(r.score_to_par ?? 0), 0);
    if (roundChanged || newerEvent) {
      event.holes_completed = Math.max(totalHoles, Number(oldEvent.holes_completed ?? 0) + (retractedHole ? totalHoles - oldTotalHoles : 0));
      const completedRounds = rounds.filter((r: GolfRecord) => r.holes_completed >= 18).length;
      event.rounds_completed = Math.max(completedRounds, Number(oldEvent.rounds_completed ?? 0) + (retractedHole ? completedRounds - oldCompletedRounds : 0));
      // Preserve tournament adjustments and historical aggregate coverage absent from hole cards.
      const allIncomingCovered = newerEvent && eventInput.official_score_to_par != null &&
        eventInput.holes_completed === totalHoles &&
        rounds.filter((r: GolfRecord) => r.holes_completed > 0).every((accepted: GolfRecord) => {
          const incoming = (batch.rounds ?? []).find(r => r.event_player_id === event.id && r.round_number === accepted.round_number);
          return incoming?.score_to_par === accepted.score_to_par && incoming?.holes_completed === accepted.holes_completed;
        });
      const adjustment = allIncomingCovered ? eventInput.official_score_to_par - totalScore :
        Number(oldEvent.official_score_to_par ?? oldRoundScore) - oldRoundScore;
      event.official_score_to_par = totalHoles > 0 || roundChanged ? totalScore + adjustment : oldEvent.official_score_to_par;
      if (!allIncomingCovered && Number(oldEvent.holes_completed ?? 0) > oldTotalHoles) {
        // Historical event-only totals already include newly discovered rounds.
        // Apply corrections to known rounds, but do not add a backfilled round twice.
        const knownDelta = (oldEvent.golf_rounds ?? []).filter((r: GolfRecord) => r.holes_completed > 0)
          .reduce((sum: number, prior: GolfRecord) => sum + Number(rounds.find((r: GolfRecord) => r.id === prior.id)?.score_to_par ?? 0) - Number(prior.score_to_par ?? 0), 0);
        event.official_score_to_par = totalHoles >= oldEvent.holes_completed
          ? totalScore + Number(oldEvent.reconciliation?.officialAdjustment ?? 0)
          : oldEvent.official_score_to_par == null ? null : oldEvent.official_score_to_par + knownDelta;
      }
      if (allIncomingCovered) event.reconciliation = { ...event.reconciliation, officialAdjustment: adjustment };
      event.official_score_display = golfScoreDisplay(event.official_score_to_par);
      event.penalty_strokes = calculateGolfPenaltyStrokes({ status: event.status, roundsCompleted: event.rounds_completed, penaltyPerRound: state.penaltyPerRound });
      event.fantasy_score = event.official_score_to_par == null ? event.penalty_strokes || null : event.official_score_to_par + event.penalty_strokes;
      if (retractedHole && event.status === "finished") event.status = "active";
      if (retractedHole && totalHoles === 0 && !terminal.has(event.status)) {
        event.status = "scheduled";
        event.last_hole = null;
      }
      if (!terminal.has(event.status) && totalHoles > 0 && event.holes_completed === totalHoles) {
        const latest = [...rounds].filter(r => r.holes_completed > 0).sort((a,b) => b.round_number-a.round_number)[0];
        if (latest && !(event.status === "scheduled" && event.current_round > latest.round_number)) {
          event.current_round = latest.round_number;
          event.status = latest.holes_completed >= 18 ? "round_complete" : "active";
          const played = (latest.golf_holes ?? []).filter((h: GolfRecord) => h.strokes != null);
          const officialLastHole = newerEvent && eventInput.current_round === latest.round_number &&
            played.some((h: GolfRecord) => h.hole_number === eventInput.last_hole) ? eventInput.last_hole : null;
          const previousRound = (oldEvent.golf_rounds ?? []).find((r: GolfRecord) => r.round_number === latest.round_number);
          const newlyPlayed = played.filter((h: GolfRecord) => !(previousRound?.golf_holes ?? []).some(
            (old: GolfRecord) => old.hole_number === h.hole_number && old.strokes != null));
          const freshest = [...newlyPlayed].sort((a, b) =>
            (Date.parse(b.reconciliation?.observedAt ?? "1970-01-01") - Date.parse(a.reconciliation?.observedAt ?? "1970-01-01")) ||
            b.hole_number - a.hole_number)[0];
          event.last_hole = officialLastHole ?? freshest?.hole_number ??
            (played.some((h: GolfRecord) => h.hole_number === event.last_hole) ? event.last_hole :
              [...played].sort((a, b) => b.hole_number - a.hole_number)[0]?.hole_number ?? null);
        }
      }
    }
    const patch: GolfRecord = { id: event.id };
    for (const key of ["leaderboard_order", "official_score_to_par", "official_score_display", "penalty_strokes", "fantasy_score", "rounds_completed", "holes_completed", "current_round", "last_hole", "status", "tee_time", "tee_time_raw", "reconciliation"]) patch[key] = event[key] ?? null;
    if (differs(oldEvent, patch)) eventWrites.push(patch);
    scoringChanged ||= roundChanged || ["fantasy_score", "status"].some(k => oldEvent[k] !== event[k]);
  }
  const competitors = events.map(e => ({ playerId: e.player_id, rounds: (e.golf_rounds ?? []).map((r: GolfRecord) => ({
    roundNumber: r.round_number, holesCompleted: r.holes_completed, scoreToPar: r.score_to_par,
    holes: (r.golf_holes ?? []).map((h: GolfRecord) => ({ relativeToPar: h.relative_to_par })),
  })) }));
  const teamRows = scoringChanged || !state.teams.length ? calculateGolfTeamResults(state.slateId, events, competitors, state.lineups, state.slateTeams) : state.teams;
  const teamWrites = scoringChanged || !state.teams.length ? teamRows.filter(row => {
    const existing = state.teams.find(t => Number(t.team_id) === row.team_id);
    return !existing || differs(existing, row);
  }) : [];
  return { events, holeWrites, roundWrites, eventWrites, teamWrites, teamRows, scoringChanged };
}
