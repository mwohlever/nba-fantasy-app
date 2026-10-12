import type { ImplicationsResponse } from "./gameImplications.server";
import type { LiveScoreGame } from "@/components/live-scores/LiveScoreCard";
import { gameSignificance, type StoryCandidate } from "./gameSignificance";

const join = (items: string[]) => items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
const round = (key: string) => key.replaceAll("_", " ");

export function gameStory(data: ImplicationsResponse, provider?: LiveScoreGame | string | null) {
  const a = data.analysis, subject = data.subject;
  if (!a || !subject) return null;
  const allowGroup = data.poolState === "available" && a.otherEntries !== null;
  const significance = gameSignificance(a, allowGroup);
  const own = subject.isAccountOwner, person = subject.entrantName;
  const who = own ? "You" : person, possessive = own ? "your" : `${person}’s`;
  const team = (id: string) => data.teamNames[id] ?? id;
  const entry = (id: number | null) => {
    if (id === subject.entryId) return own ? "You" : person;
    const row = data.subjects.find((row) => row.entryId === id);
    return row ? data.subjects.filter((other) => other.entrantId === row.entrantId).length > 1 ? row.label : row.entrantName : "Another entry";
  };
  const entryPossessive = (id: number | null) => id === subject.entryId ? possessive : `${entry(id)}’s`;
  const personal = a.entryStates.find((row) => row.isSubject)!;
  const describe = (candidate: StoryCandidate) => {
    const t = candidate.teamId ? team(candidate.teamId) : "";
    const id = candidate.entryIds?.[0] ?? subject.entryId;
    switch (candidate.kind) {
      case "low_impact": {
        const unanimous = allowGroup ? a.exposure.find((row) => row.selectedCount === a.totalEntries) : null;
        const split = allowGroup ? a.futureSplits[0] : null;
        return { headline: unanimous ? `Everyone picked ${team(unanimous.teamId)} here.` : allowGroup ? "There isn’t much separating the brackets in this game." : `${own ? "You have" : `${person} has`} no points left in this matchup.`,
          body: allowGroup ? split ? `The picks split in the ${round(split.roundKey)}: ${join(split.teams.map((row) => team(row.teamId)))}. This game itself awards the same points to every entry under either result.`
            : "Neither outcome creates a points difference between entries here, and nobody has points left in later picks for either team."
            : `${own ? "You don’t" : `${person} doesn’t`} have points left to win from this matchup.`, };
      }
      case "unique_champion": return { headline: id === subject.entryId ? `${own ? "You’re" : `${person} is`} the only one with ${t} winning it all.` : `${t} is ${entry(id)}’s championship gamble.`,
        body: `${id === subject.entryId ? own ? "Your" : `${person}’s` : `${entry(id)}’s`} championship pick is the only one riding on ${t}. ${a.matchupConfirmed ? "A loss here would end it." : "If they reach this game, a loss would end it."}` };
      case "personal_champion": return { headline: `${own ? "You’ve got" : `${person} has`} ${t} winning the whole thing.`, body: `${a.matchupConfirmed ? "Lose here" : "Reach this game and lose"}, and ${possessive} championship pick is gone.${a.isChampionship ? ` That selection is worth ${a.exposure.find((row) => row.teamId === candidate.teamId)?.immediatePointsIfWinner ?? 0} championship points.` : ""}` };
      case "eliminated_interest": return { headline: `${own ? "You’re" : `${person} is`} out of points here. ${entry(id)} still has ${candidate.points} riding on ${t}.`, body: `Those are later picks that still depend on ${t} surviving${a.matchupConfirmed ? " this game" : " if they reach it"}.` };
      case "shared_dependency": return { headline: `${own ? "You need" : `${person} needs`} ${t} here. ${entry(id)} has even more riding on them.`,
        body: `${entry(id)} has ${candidate.points} points in later ${t} picks.${a.exposure.find((row) => row.teamId === candidate.teamId)?.championEntries?.some((row) => row.entryId === id && row.alive) ? ` That includes ${entryPossessive(id)} championship pick.` : ""}${!a.matchupConfirmed ? ` These picks depend on ${t} reaching this game first.` : ""}` };
      case "elimination_threat": return { headline: `${t} losing would take several of ${entryPossessive(id)} picks with them.`, body: `${candidate.points} points from later wins would be lost, beyond anything awarded in this game.${!a.matchupConfirmed ? ` That is conditional on ${t} reaching this matchup.` : ""}` };
      case "unique_pick": return { headline: `${entry(id)} ${id === subject.entryId && own ? "stand" : "stands"} alone on ${t}.`, body: `Nobody else picked them to win this game${a.matchupConfirmed ? "." : ", if they get here."}` };
      case "consensus": return { headline: `The whole Group is with ${t} on this one.`, body: !a.matchupConfirmed ? `Everyone picked ${t} at this round, if they get here.` : a.futureSplits.length ? `Their picks part ways in the ${round(a.futureSplits[0].roundKey)}.` : a.outcomes.some((row) => !row.sameImmediatePoints) ? "They agree on the winner, but that pick is worth different points in their entries." : "This game awards the same points to every entry under either result." };
      case "conflict": {
        const choices = a.exposure.filter((row) => (row.selectedCount ?? 0) > 0);
        return { headline: `${team(choices[0].teamId)} or ${team(choices[1].teamId)}: the Group is split.`, body: join(choices.map((row) => `${row.selectedCount} ${row.selectedCount === 1 ? "entry picked" : "entries picked"} ${team(row.teamId)}`)) + "." };
      }
      case "personal_path": {
        const p = a.personalPath!;
        return { headline: p.nextLoss?.nextRound ? `${t} is ${possessive} pick for this game, then ${team(p.nextLoss.pickedWinnerId)} takes over.`
          : p.futureWins.length ? `${t} has a longer road in ${possessive} bracket.` : `${own ? "You’ve" : `${person} has`} picked ${t} here.`,
          body: p.futureWins.length ? `${own ? "You have" : `${person} has`} them through the ${round(p.lastSelectedWin!.roundKey)}${p.nextLoss ? `, then ${team(p.nextLoss.pickedWinnerId)} in the ${round(p.nextLoss.roundKey)}` : ""}. ${p.additionalPoints} more points depend on those later wins.` : `${a.exposure.find((row) => row.teamId === p.teamId)?.immediatePointsIfWinner ?? 0} points are available for that pick in this game.` };
      }
      default: return { headline: "Official result", body: "" };
    }
  };
  const official = Boolean(a.officialWinner);
  const phase = official ? "official" : typeof provider === "string" ? provider === "post" ? "provider_final" : provider === "in" ? "live" : "pregame"
    : provider?.status === "post" ? "provider_final" : provider?.status === "in" || data.game?.officialStatus === "in_progress" ? "live" : "pregame";
  const providerGame = typeof provider === "object" ? provider : null;
  const validScore = providerGame && a.matchupConfirmed && [providerGame.awayTeam.id, providerGame.homeTeam.id].every((id) => a.participants.includes(id))
    && typeof providerGame.awayTeam.score === "number" && Number.isFinite(providerGame.awayTeam.score) && providerGame.awayTeam.score >= 0
    && typeof providerGame.homeTeam.score === "number" && Number.isFinite(providerGame.homeTeam.score) && providerGame.homeTeam.score >= 0;
  const margin = validScore ? Math.abs(providerGame!.awayTeam.score! - providerGame!.homeTeam.score!) : null;
  const apparentWinner = validScore && margin! > 0 ? providerGame!.awayTeam.score! > providerGame!.homeTeam.score! ? providerGame!.awayTeam.id : providerGame!.homeTeam.id : null;
  let main = describe(significance.primary);
  let supports = significance.supporting.map((candidate) => ({ ...describe(candidate), id: candidate.id }));
  const recap: string[] = [];
  let championship: { champion: string; runnerUp: string | null; score: string | null } | null = null;
  if (official) {
    const winner = a.officialWinner!;
    if (a.isChampionship) {
      main = { headline: `${team(winner)} are national champions.`, body: personal.championPick === winner
        ? `${who} picked the champion and earned ${a.subject.gamePointsEarned} championship points.`
        : `${own ? "You had" : `${person} had`} ${personal.championPick ? team(personal.championPick) : "no team"} winning it all. The final added no points to ${possessive} bracket.` };
      championship = { champion: team(winner), runnerUp: a.championship.runnerUp ? team(a.championship.runnerUp) : null,
        score: phase === "official" && providerGame?.status === "post" && validScore && apparentWinner === winner
          ? `${team(providerGame.awayTeam.id)} ${providerGame.awayTeam.score} – ${team(providerGame.homeTeam.id)} ${providerGame.homeTeam.score}` : null };
      if (allowGroup) {
        const correct = a.entryStates.filter((row) => row.championPick === winner);
        if (correct.length === 1) recap.push(`${entry(correct[0].entryId)} ${correct[0].isSubject && own ? "were" : "was"} the only entry to pick ${team(winner)} as champion.`);
        if (a.tournamentComplete && a.finalStandings) {
          const viewed = a.finalStandings.find((row) => row.isSubject)!;
          recap.push(`${who} finished ${viewed.tied ? "tied " : ""}#${viewed.rank} on points with ${viewed.earned} points.`);
          const leaders = a.finalStandings.filter((row) => row.rank === 1);
          recap.push(`${join(leaders.map((row) => entry(row.entryId)))} ${leaders.length === 1 ? "finished first" : "shared first place"} on points (${leaders[0].earned}).`);
        }
      }
    } else {
      const lost = a.outcomes[0];
      const titleLosses = allowGroup ? a.exposure.find((row) => row.teamId === lost.loserTeamId)?.championEntries?.filter((row) => row.aliveBefore) ?? [] : [];
      main = { headline: titleLosses.length ? `${team(winner)} won. ${join(titleLosses.map((row) => entryPossessive(row.entryId)))} championship ${titleLosses.length === 1 ? "pick is" : "picks are"} out.` : `${team(winner)} won. ${who} earned ${a.subject.gamePointsEarned} points.`,
        body: lost.subject.lostPicks.length ? `The result cost ${possessive} bracket ${lost.subject.futureCeilingLost} points that had been possible from later ${team(lost.loserTeamId)} wins.` : "" };
      if (allowGroup) for (const rival of [...(lost.rivals ?? [])].filter((row) => row.futureCeilingLost > 0).sort((a, b) => b.futureCeilingLost - a.futureCeilingLost).slice(0, 2))
        recap.push(`${entry(rival.entryId)} lost ${rival.futureCeilingLost} possible points from later ${team(lost.loserTeamId)} picks.`);
      if (allowGroup) {
        const scorers = a.entryStates.filter((row) => row.gamePoints > 0);
        if (scorers.length) recap.push(`${join(scorers.slice(0, 4).map((row) => `${entry(row.entryId)} (${row.gamePoints})`))} earned points here.`);
        const winningExposure = a.exposure.find((row) => row.teamId === winner);
        const most = [...(winningExposure?.rivalExposure ?? [])].sort((a, b) => b.currentFuturePoints - a.currentFuturePoints)[0];
        if (most && most.currentFuturePoints > (winningExposure?.currentFuturePoints ?? 0)) recap.push(`${entry(most.entryId)} still has ${most.currentFuturePoints} points available from later ${team(winner)} wins.`);
      }
    }
    supports = [];
  } else if ((phase === "live" || phase === "provider_final") && apparentWinner) {
    const loser = a.participants.find((id) => id !== apparentWinner)!;
    const threatened = allowGroup ? a.exposure.find((row) => row.teamId === loser)?.championEntries?.filter((row) => row.alive) ?? []
      : personal.championPick === loser && personal.championStatus === "pending" ? [{ entryId: subject.entryId }] : [];
    main = { headline: phase === "live" ? `${team(apparentWinner)} leads by ${margin}.` : `${team(apparentWinner)} finished ahead on the scoreboard.`,
      body: threatened.length ? `${phase === "live" ? "If that holds" : "If the official result confirms it"}, ${join(threatened.map((row) => entryPossessive(row.entryId)))} championship ${threatened.length === 1 ? "pick would be" : "picks would be"} gone.` : `The ${phase === "live" ? "lead" : "scoreboard result"} is still conditional for bracket scoring.` };
    const primary = describe(significance.primary);
    supports = threatened.length ? [] : [{ ...primary, id: significance.primary.id }];
  }
  return { significance, phase, main, supports, recap, championship,
    status: phase === "live" ? "Nothing is settled yet. Only an official result awards bracket points."
      : phase === "provider_final" ? "Official advancement is pending. No points or eliminations are confirmed by this scoreboard alone." : null,
    showOutcomes: !official && phase !== "provider_final" && a.matchupConfirmed && significance.primary.kind !== "low_impact"
      && (allowGroup ? significance.competitiveDifference : (a.personalPath?.futureWins.length ?? 0) > 0),
    finalPosition: allowGroup && a.tournamentComplete ? a.finalStandings?.find((row) => row.isSubject) ?? null : null };
}
