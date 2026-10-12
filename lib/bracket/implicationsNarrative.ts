import type { ImplicationsResponse } from "./gameImplications.server";
import type { LiveScoreGame } from "@/components/live-scores/LiveScoreCard";
import { gameStory } from "./gameStory";

const join = (items: string[]) => items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
const roundName = (key: string) => ({ first_round: "first round", quarterfinal: "quarterfinals", quarterfinals: "quarterfinals",
  semifinal: "semifinals", semifinals: "semifinals", championship: "championship", national_championship: "championship", title: "championship", semi: "semifinals" }[key] ?? key.replaceAll("_", " "));

/** Presentation only: every sentence is derived from Phase 1 facts, never a scenario or rooting recommendation. */
export function gameImplicationsNarrative(data: ImplicationsResponse, provider?: LiveScoreGame | string | null) {
  const providerStatus = typeof provider === "string" ? provider : provider?.status;
  // The server already removes private comparisons. Keep all presentation outputs fail-closed too.
  if (data.analysis && data.poolState !== "available") data = { ...data, analysis: { ...data.analysis,
    totalEntries: null, otherEntries: null, finalStandings: null, futureSplits: [],
    entryStates: data.analysis.entryStates.filter((row) => row.isSubject),
    exposure: data.analysis.exposure.map((row) => ({ ...row, selectedCount: null, rivalExposure: null, championEntries: null, longerRivalPaths: null })),
    outcomes: data.analysis.outcomes.map((row) => ({ ...row, rivals: null, sameImmediatePoints: null })),
  } };
  const { analysis, subject } = data;
  if (!analysis || !subject) return null;
  const name = (id: string) => data.teamNames[id] ?? id;
  const own = subject.isAccountOwner;
  const person = subject.entrantName;
  const who = own ? "You" : person;
  const possessive = own ? "your" : `${person}’s`;
  const entryName = (id: number | null, fallback: string) => {
    const entry = data.subjects.find((row) => row.entryId === id);
    if (!entry) return fallback;
    return data.subjects.filter((row) => row.entrantId === entry.entrantId).length > 1 || entry.entrantId === subject.entrantId
      ? entry.label : entry.entrantName;
  };
  const official = Boolean(analysis.officialWinner);
  const picked = analysis.exposure.find((row) => row.pickedHere);
  let headline = official
    ? `${name(analysis.officialWinner!)} won. ${who} earned ${analysis.subject.gamePointsEarned} points.`
    : !analysis.subject.pick ? `${own ? "You haven’t" : `${person} hasn’t`} picked a winner here yet.`
      : !analysis.subject.eligibleToScore ? `${own ? "Your" : `${person}’s`} pick, ${name(analysis.subject.pick)}, is already out.`
        : `${own ? "You’ve" : `${person} has`} picked ${name(analysis.subject.pick)}${analysis.matchupConfirmed ? " to win here" : " to win this round"}.`;
  if (!official && analysis.matchupConfirmed && picked?.nextDifferentPick && picked.longerRivalPaths?.length) {
    headline = `${own ? "You’ve got" : `${person} has`} ${name(picked.teamId)} winning here. ${join(picked.longerRivalPaths.slice(0, 2).map((row) => entryName(row.entryId, row.label)))} ${picked.longerRivalPaths.length === 1 ? "needs" : "need"} them to go farther.`;
  }
  const path = analysis.personalPath;
  const alivePath = path && analysis.subject.eligibleToScore && !official;
  if (alivePath && data.poolState !== "available") {
    if (path.champion) headline = `${own ? "You’ve got" : `${person} has`} ${name(path.teamId)} going all the way.`;
    else if (path.futureWins.length) headline = `${name(path.teamId)} isn’t just ${possessive} pick for this game.`;
    else if (path.nextLoss?.nextRound) headline = `${own ? "You need" : `${person} needs`} ${name(path.teamId)} for this round, then ${name(path.nextLoss.pickedWinnerId)} in the ${roundName(path.nextLoss.roundKey)}.`;
  }
  const pathText = alivePath ? (() => {
    const predictedOpponents = path.wins.filter((win) => win.status === "pending").map((win) => win.predictedOpponentId).filter((id): id is string => Boolean(id));
    const ending = path.nextLoss ? `, then losing to ${name(path.nextLoss.pickedWinnerId)} in the ${roundName(path.nextLoss.roundKey)}`
      : path.champion ? " and winning the championship" : path.lastSelectedWin ? ` through the ${roundName(path.lastSelectedWin.roundKey)}` : "";
    return `${own ? "Your" : `${person}’s`} predicted path has ${name(path.teamId)}${predictedOpponents.length ? ` beating ${join(predictedOpponents.map(name))}` : " advancing"}${ending}.`;
  })() : null;
  const stakes = alivePath && (path.futureWins.length || path.nextLoss) ? {
    futureRounds: path.futureWins.map((win) => ({ label: roundName(win.roundKey), points: win.points })),
    additionalPoints: path.additionalPoints,
    explanation: path.futureWins.length
      ? `${name(path.teamId)} losing here would wipe out ${possessive} picks in ${path.futureWins.length + 1} rounds, leaving ${path.pointsAtRisk} possible points behind (${path.additionalPoints} from later wins).`
      : `${own ? "You’ve" : `${person} has`} picked ${name(path.teamId)} to lose ${path.nextLoss?.nextRound ? "next round" : `in the ${roundName(path.nextLoss!.roundKey)}`}. This game is ${possessive} last selected win for them.`,
  } : null;
  const context = official ? "Official result confirmed."
    : providerStatus === "post" ? "Final on the scoreboard; official advancement is still pending. The possibilities below aren’t confirmed yet."
      : providerStatus === "in" ? "The score is live. These possibilities aren’t confirmed until the official winner is saved."
        : !analysis.matchupConfirmed ? "The matchup isn’t set yet. These possibilities depend on each team reaching this game." : null;
  const cards = analysis.matchupConfirmed ? analysis.outcomes.map((row) => ({
    teamId: row.teamId, title: official ? `${name(row.teamId)} won` : `If ${name(row.teamId)} wins`,
    points: row.subject.immediatePoints,
    award: `${who} ${official ? "earned" : own ? "earn" : "earns"} ${row.subject.immediatePoints} points`,
    rivalAwards: (row.rivals ?? []).filter((entry) => entry.immediatePoints > 0 && entry.immediatePoints !== row.subject.immediatePoints)
      .map((entry) => `${entryName(entry.entryId, entry.label)} ${official ? "earned" : "earns"} ${entry.immediatePoints} points.`),
    consequences: row.subject.lostPicks.length ? [`${official ? "That ended" : "That would end"} ${possessive} ${name(row.loserTeamId)} picks in the ${join(row.subject.lostPicks.map((pick) => roundName(pick.roundKey)))} (${row.subject.futureCeilingLost} possible points ${official ? "lost" : "at risk"} from later wins).`] : [],
    rivals: (row.rivals ?? []).filter((entry) => entry.lostPicks.length).map((entry) =>
      `${entryName(entry.entryId, entry.label)} ${official ? "had" : "has"} ${name(row.loserTeamId)} reaching the ${join(entry.lostPicks.map((pick) => roundName(pick.roundKey)))}. ${official ? "The win knocked out" : `${name(row.teamId)} winning would knock out`} those picks (${entry.futureCeilingLost} points).`),
  })) : analysis.exposure.filter((row) => row.pickedHere || row.futurePicks.length).map((row) => ({
    teamId: row.teamId, title: `If ${name(row.teamId)} reaches this game and wins`, points: row.immediatePointsIfWinner,
    award: `${who} ${own ? "earn" : "earns"} ${row.immediatePointsIfWinner} points`,
    rivalAwards: [],
    consequences: row.futurePicks.length ? [`${own ? "You also have" : `${person} also has`} ${name(row.teamId)} in the ${join(row.futurePicks.map((pick) => roundName(pick.roundKey)))}. Losing here would end those picks.`] : [],
    rivals: (row.rivalExposure ?? []).filter((entry) => entry.futurePicks.length).map((entry) =>
      `${entryName(entry.entryId, entry.label)} also ${official ? "had" : "has"} ${name(row.teamId)} reaching the ${join(entry.futurePicks.map((pick) => roundName(pick.roundKey)))}.`),
  }));
  const notes: string[] = [];
  for (const row of analysis.exposure) {
    if (row.pickedHere && row.nextDifferentPick && row.longerRivalPaths?.length) {
      const champions = (row.championEntries ?? []).filter((entry) => !entry.isSubject);
      notes.push(`${own ? "You picked" : `${person} picked`} ${name(row.teamId)} to win here, then ${name(row.nextDifferentPick.teamId)} in the ${roundName(row.nextDifferentPick.roundKey)}.${champions.length ? ` ${join(champions.map((entry) => entryName(entry.entryId, entry.label)))} ${official ? "had" : "picked"} ${name(row.teamId)} ${official ? "winning" : "to win"} it all.` : ""}`);
    } else if (row.futurePicks.length && (!pathText || !row.pickedHere) && (!official || row.teamId === analysis.officialWinner)) {
      notes.push(`${own ? "You also picked" : `${person} also picked`} ${name(row.teamId)} in the ${join(row.futurePicks.map((pick) => roundName(pick.roundKey)))}.${official ? " This win kept those picks possible at the time." : " A win keeps those picks possible."}`);
    }
    if (!row.pickedHere && row.championEntries?.some((entry) => !entry.isSubject)) {
      const champions = row.championEntries.filter((entry) => !entry.isSubject);
      notes.push(`${join(champions.map((entry) => entryName(entry.entryId, entry.label)))} ${official ? "had" : "picked"} ${name(row.teamId)} ${official ? "winning" : "to win"} it all.${official && !champions.some((entry) => entry.alive) ? " Those championship picks are out." : ""}`);
    }
  }
  const consensus = analysis.exposure.filter((row) => (row.selectedCount ?? 0) > 0).map((row) =>
    `${row.selectedCount} of ${analysis.totalEntries} ${official ? "picked" : "have"} ${name(row.teamId)}${official ? " to win" : " winning"} here${!analysis.matchupConfirmed ? ", if they get here" : ""}.`);
  const agreements = picked?.rivalExposure?.filter((row) => row.pickedHere) ?? [];
  const conflicts = analysis.exposure.filter((row) => !row.pickedHere).flatMap((row) => (row.rivalExposure ?? [])
    .filter((entry) => entry.pickedHere).map((entry) => `${entryName(entry.entryId, entry.label)} picked ${name(row.teamId)}`));
  const comparison = !official && analysis.matchupConfirmed && agreements.length && analysis.subject.pick
    ? `${join([who, ...agreements.map((entry) => entryName(entry.entryId, entry.label))])} agree on ${name(analysis.subject.pick)}.${conflicts.length ? ` ${join(conflicts)}.` : ""}` : null;
  // Legacy fact/copy fields remain available to existing consumers; the editorial UI uses story.
  return { story: gameStory(data, provider), headline, context, pathText, stakes, cards, notes: [...new Set(notes)], consensus, comparison,
    privacy: data.poolState === "pre_lock" ? "Other brackets will be available once the contest locks." : data.poolState === "freezing" ? "Other brackets are still being finalized. Group comparisons will appear when they’re ready." : null };
}
