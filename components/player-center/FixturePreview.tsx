"use client";
import { useMemo, useState } from "react";
import { compareHistories } from "@/lib/player-center/comparison";
import { presentProfile, type PresentableHistory } from "@/lib/player-center/presentation";
import { professionalSeason, type CenterSport } from "@/lib/player-center/types";
import type { CenterIdentity } from "@/lib/player-center/display";
import type { CenterLoader } from "./data";
import PlayerCenter from "./PlayerCenter";
import PlayerCenterModal from "./PlayerCenterModal";
import ResearchBrowser from "./ResearchBrowser";

const identity = (history: PresentableHistory): CenterIdentity => ({ id: history.player.playerId, name: history.player.name, positionGroup: history.player.position,
  nbaPlayerId: history.player.sport === "nba" ? Number(history.player.nativePlayerId) : null, nflPlayerId: history.player.sport === "nfl" ? Number(history.player.nativePlayerId) : null });

export default function FixturePreview({ histories, capturedAt, correctionsVerifiedAt }: { histories: PresentableHistory[]; capturedAt: string; correctionsVerifiedAt?: string }) {
  const [sport, setSport] = useState<CenterSport>("nba");
  return <main className="pc pc-preview" data-sport={sport}><header className="pc-page-heading"><div><span className="pc-eyebrow">111 SPORTS · LOCAL PREVIEW</span><h1>Player Center</h1><p>Captured {new Date(capturedAt).toLocaleString()} · isolated fixture pool · no saved picks</p>{correctionsVerifiedAt && <p>Fumble evidence re-verified {new Date(correctionsVerifiedAt).toLocaleDateString()} · original season sample retained</p>}</div></header>
    <div className="pc-preview-controls" aria-label="Preview sport"><button aria-pressed={sport === "nba"} onClick={() => setSport("nba")}>NBA</button><button aria-pressed={sport === "nfl"} onClick={() => setSport("nfl")}>NFL</button></div>
    <PreviewSport key={sport} {...{ sport, histories, capturedAt }} />
  </main>;
}
function PreviewSport({ sport, histories, capturedAt }: { sport: CenterSport; histories: PresentableHistory[]; capturedAt: string }) {
  const season = professionalSeason(sport, new Date(capturedAt));
  const pool = histories.filter(history => history.player.sport === sport && history.season === season);
  const [selected, setSelected] = useState<CenterIdentity>(identity(pool[0]));
  const [modal, setModal] = useState(false), [missing, setMissing] = useState(false);
  const loader = useMemo<CenterLoader>(() => ({
    profile: async request => {
      const found = histories.find(history => history.player.sport === request.sport && history.player.playerId === request.playerId && history.season === request.season);
      const base = histories.find(history => history.player.sport === request.sport && history.player.playerId === request.playerId);
      if (!base) throw new Error("Exact player is not in this fixture capture.");
      const history: PresentableHistory = found && !missing ? found : { ...base, games: [], season: request.season, seasonStats: null, byeWeeks: null, coverage: { kind: "unavailable", expectedGames: null, fetchedAt: null, freshness: "unavailable", issues: [missing ? "simulated_missing_data_QA_scenario" : "season_not_in_fixture_capture"] } };
      return presentProfile(history, { sport: request.sport, settings: null, basis: "legacy_defaults" }, capturedAt);
    },
    comparisons: async request => compareHistories({ ...request, scoring: { sport: request.sport, settings: null, basis: "legacy_defaults" } }, histories.filter(history => history.player.sport === request.sport && history.season === request.season), capturedAt, capturedAt),
  }), [histories, capturedAt, missing]);
  return <><div className="pc-fixture">CAPTURED FIXTURES ONLY · pool contains {pool.length} representative {sport.toUpperCase()} players, not the complete league. Preview scoring uses canonical defaults.</div>
    <div className="pc-preview-controls"><button onClick={() => setModal(true)}>Open player modal</button><button aria-pressed={missing} onClick={() => setMissing(value => !value)}>{missing ? "Restore captured data" : "Simulate missing profile data"}</button></div>
    <div className="pc-preview-layout"><ResearchBrowser sport={sport} season={season} loader={loader} fixture onInspect={setSelected} selectedId={selected.id} /><PlayerCenter identity={selected} sport={sport} season={season} loader={loader} fixture expanded /></div>
    {modal && <PlayerCenterModal identity={selected} sport={sport} season={season} loader={loader} fixture onClose={() => setModal(false)} />}
  </>;
}
