"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import AppNav from "@/components/AppNav";
import TeamAvatar from "@/components/ui/TeamAvatar";
import EditNameButton from "@/components/ui/EditNameButton";
import TextEntryDialog from "@/components/ui/TextEntryDialog";
import { bracketEntrantProfileHref } from "@/lib/bracket/navigation";
import { bracketDisplayLabel } from "@/lib/bracket/names";
import CfpFieldSetup from "./CfpFieldSetup";

type Data = {
  detail: {
    group: { name: string };
    canAdministerGroup: boolean;
    canManageCompetitionField: boolean;
    contest: { status: string; rulesSnapshot: Record<string, unknown> };
    competition: { id: number; name: string; season: number; formatKey: string };
  };
  picksVisible: boolean;
  poolVisibility: "pre_lock" | "freezing" | "available";
  rounds: { key: string; label: string }[];
  participation: { entryId: number; entrantId: string; entrantName: string; entrantKind: string; avatarUrl: string | null; bracketNumber: number; bracketName: string | null; completionState: "in_progress" | "complete" | "locked"; isMine: boolean }[];
  personalSummary: { totalBrackets: number; completeBrackets: number };
  standings: { entryId: number; entrantId: string; rank: number; entrantName: string; entrantKind: string; avatarUrl: string | null; bracketNumber: number; bracketName: string | null; entryStatus: string; pointsEarned: number; maxPossibleScore: number; correctPicks: number; pendingPicks: number; eliminatedPicks: number; championPick: string | null; canViewBracket: boolean }[];
};

function EntrantProfileLink({ entry, contestId }: {
  entry: { entrantId: string; entrantName: string; avatarUrl: string | null; bracketNumber: number; bracketName: string | null };
  contestId: string;
}) {
  return <Link
    href={bracketEntrantProfileHref(entry.entrantId, contestId)}
    aria-label={`Open ${entry.entrantName}'s Bracket Profile`}
    className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg py-1 pr-2 text-left font-bold text-slate-100 transition hover:text-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300"
  >
    <span className="shrink-0"><TeamAvatar teamName={entry.entrantName} avatarUrl={entry.avatarUrl} useLegacyFallback={false} size="sm" /></span>
    <span className="min-w-0 truncate">{entry.entrantName}{entry.bracketName || entry.bracketNumber > 1 ? ` · ${bracketDisplayLabel(entry.bracketNumber, entry.bracketName)}` : ""}</span>
  </Link>;
}

const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
function scoring(snapshot: Record<string, unknown>, key: string) {
  const raw = snapshot.scoring as Record<string, unknown> | undefined;
  const points = raw?.roundPoints as Record<string, unknown> | undefined ?? raw;
  return typeof points?.[key] === "number" ? points[key] : null;
}
function completionLabel(state: "in_progress" | "complete" | "locked") {
  if (state === "complete") return "Complete";
  if (state === "locked") return "Locked";
  return "In progress";
}

export default function BracketChallengeHomePage() {
  const { contestId } = useParams<{ contestId: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [showFieldTools, setShowFieldTools] = useState(false);
  const [renameEntry, setRenameEntry] = useState<Data["participation"][number] | null>(null);

  async function renameParticipationBracket(name: string) {
    if (!renameEntry) return;
    const response = await fetch(`/api/bracket-challenge/contests/${encodeURIComponent(contestId)}/master-bracket`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename", entrantId: renameEntry.entrantId, bracketNumber: renameEntry.bracketNumber, name }),
    });
    const result = await response.json() as { name?: string | null; error?: string };
    if (!response.ok) throw new Error(result.error ?? "Unable to rename bracket.");
    setData((current) => current ? {
      ...current,
      participation: current.participation.map((entry) => entry.entryId === renameEntry.entryId ? { ...entry, bracketName: result.name ?? null } : entry),
    } : current);
  }

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/bracket-challenge/contests/${encodeURIComponent(contestId)}/leaderboard`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Unable to load Bracket Challenge.");
        return result as Data;
      })
      .then((result) => { if (!cancelled) setData(result); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load Bracket Challenge."); });
    return () => { cancelled = true; };
  }, [contestId]);

  if (!data && !error) return <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6"><div className="mx-auto max-w-5xl space-y-6"><AppNav /><p className="mt-5 text-sm text-slate-400">Loading challenge…</p></div></main>;
  if (!data) return <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6"><div className="mx-auto max-w-5xl space-y-6"><AppNav /><p className="mt-5 rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">{error}</p></div></main>;

  const { detail } = data;
  const scoreSummary = data.rounds.map((round) => {
    const points = scoring(detail.contest.rulesSnapshot, round.key);
    return points === null ? null : `${round.label} ${points}`;
  }).filter((value): value is string => Boolean(value));
  const personalCompletion = data.personalSummary.totalBrackets === 0
    ? "No admitted brackets yet"
    : data.personalSummary.totalBrackets === 1
      ? data.personalSummary.completeBrackets === 1 ? "Bracket complete" : "Bracket in progress"
      : `${data.personalSummary.completeBrackets} of ${data.personalSummary.totalBrackets} brackets complete`;
  const participationScroll = data.participation.length > 12 ? "max-h-[34rem] overflow-y-auto pr-1" : "";

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <AppNav />

        <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">Bracket Challenge · {detail.group.name}</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">{detail.competition.name}</h1>
            <p className="mt-1 text-sm text-slate-400">{detail.competition.season} season</p>
          </div>
          <span className="rounded-full bg-blue-300/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-blue-200">{label(detail.contest.status)}</span>
        </div>

        <section className="mt-5">
          {!data.picksVisible ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div><h2 className="text-xl font-black text-white">Your bracket</h2><p className="mt-1 text-sm text-slate-400">Make or finish picks before the contest locks.</p></div>
                <Link href={`/bracket-challenge/${contestId}/bracket`} className="rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-400">Go to bracket</Link>
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-300">{personalCompletion}</p>
              <div className="mt-7"><h2 className="text-xl font-black text-white">Leaderboard</h2><p className="mt-1 text-sm text-slate-400">{data.poolVisibility === "freezing" ? "Frozen brackets are being prepared. Pool standings will appear when every entry is ready." : "Bracket participation is visible; picks remain private until lock."}</p></div>
              <div className={`mt-4 divide-y divide-slate-800 border-y border-slate-800 ${participationScroll}`}>
                {data.participation.length ? data.participation.map((entry) => <div key={entry.entryId} className="flex min-w-0 items-center justify-between gap-2 py-2 text-sm"><span className="flex min-w-0 items-center gap-1"><EntrantProfileLink entry={entry} contestId={contestId} />{entry.isMine ? <EditNameButton label={bracketDisplayLabel(entry.bracketNumber, entry.bracketName)} onClick={() => setRenameEntry(entry)} /> : null}</span><span className="shrink-0 text-slate-400">{completionLabel(entry.completionState)}</span></div>) : <p className="py-4 text-sm text-slate-400">No brackets have been admitted yet.</p>}
              </div>
              <p className="mt-4 text-xs text-slate-500">{data.poolVisibility === "freezing" ? "Pool insights are pending the complete frozen cohort." : "Picks and championship totals remain private until the contest lock."}</p>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-black text-white">Leaderboard</h2><p className="mt-1 text-sm text-slate-400">Ranked by points earned. Equal scores remain tied until a valid final tiebreak can be resolved.</p></div><Link href={`/bracket-challenge/${contestId}/bracket`} className="text-sm font-bold text-blue-300 transition hover:text-blue-200">My bracket</Link></div>
              <div className="mt-4 divide-y divide-slate-800 border-y border-slate-800">
                {data.standings.map((entry) => <div key={entry.entryId} className="py-4"><div className="flex items-start justify-between gap-3"><div className="flex gap-3"><span className="min-w-6 pt-2 text-lg font-black text-blue-300">{entry.rank}</span><div><EntrantProfileLink entry={entry} contestId={contestId} /><p className="text-xs text-slate-400">{entry.entrantKind === "managed" ? "Managed entrant · " : ""}{entry.entryStatus}</p></div></div><div className="text-right"><p className="text-xl font-black text-white">{entry.pointsEarned}</p><p className="text-xs text-slate-400">max {entry.maxPossibleScore}</p></div></div><div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-9 text-xs text-slate-400"><span>{entry.correctPicks} correct</span><span>{entry.pendingPicks} alive</span><span>{entry.eliminatedPicks} eliminated</span>{entry.championPick && <span>Champion: {entry.championPick}</span>}{entry.canViewBracket && <Link className="ml-auto font-bold text-blue-300 hover:text-blue-200" href={`/bracket-challenge/${contestId}/bracket?entryId=${entry.entryId}`}>View bracket</Link>}</div></div>)}
              </div>
            </>
          )}
        </section>

        {scoreSummary.length > 0 && <details className="mt-6 text-xs text-slate-500"><summary className="cursor-pointer font-semibold text-slate-400">Scoring rules</summary><p className="mt-2">{scoreSummary.join(" · ")} points</p></details>}

        {detail.canManageCompetitionField && detail.competition.formatKey === "cfp" && <section className="mt-8 border-t border-amber-400/20 pt-5"><button type="button" onClick={() => setShowFieldTools((current) => !current)} className="text-xs font-bold text-amber-300 transition hover:text-amber-200">{showFieldTools ? "Hide" : "Show"} super-admin global CFP field tools</button>{showFieldTools && <CfpFieldSetup competitionId={detail.competition.id} />}</section>}
        {renameEntry ? <TextEntryDialog
          key={`participation:${renameEntry.entryId}`}
          title="Rename bracket"
          label="Bracket name"
          description="Leave blank to use the default bracket number."
          initialValue={renameEntry.bracketName ?? ""}
          submitLabel="Save"
          onSubmit={renameParticipationBracket}
          onClose={() => setRenameEntry(null)}
        /> : null}
      </div>
    </main>
  );
}
