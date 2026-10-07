/** Local proof replay only. Never queries/reconciles fantasy data or reads donor player files. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { GolfHoleReplay } from "../../providers/pgaTourShots";
import { currentPreparationInput, isShotcast3DView, matchesReplayEndpoints } from "../shotcast3dView";
import { resolveDevelopmentShotcast } from "../developmentAssetResolver.server";
import { sha256 } from "./pgaAcquisition.server";

export async function readDevelopmentProof(proofId?: string): Promise<GolfHoleReplay | null> {
  if (process.env.NODE_ENV !== "development" || process.env.SHOTCAST_PREPARATION_PROOF !== "1") return null;
  try {
    let directory = path.join(/*turbopackIgnore: true*/ process.cwd(), "tmp/shotcast-phase4b");
    if (proofId && proofId !== "waialae") {
      if (!/^[a-z0-9-]+$/.test(proofId)) return null;
      const matches = (await readDevelopmentProofChoices()).filter(p => p.id === proofId);
      if (matches.length !== 1) return null;
      directory = path.join(/*turbopackIgnore: true*/ process.cwd(), "tmp/shotcast-phase4c/proofs", proofId);
    }
    const proof = JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(directory, "numeric-proof.json"), "utf8"));
    const bytes = await readFile(/*turbopackIgnore: true*/ path.join(directory, "replay.json"));
    if (proof.result !== "NUMERIC_PASS" || proof.replaySha256 !== sha256(bytes)) return null;
    const replay = JSON.parse(bytes.toString()) as GolfHoleReplay;
    const view = await resolveDevelopmentShotcast(currentPreparationInput(replay));
    if (!isShotcast3DView(view) || view.packageId !== proof.packageId || !matchesReplayEndpoints(view, replay)) return null;
    return replay;
  } catch { return null; }
}

export type DevelopmentProofChoice = { id: string; label: string };
export async function readDevelopmentProofChoices(): Promise<DevelopmentProofChoice[]> {
  if (process.env.NODE_ENV !== "development" || process.env.SHOTCAST_PREPARATION_PROOF !== "1") return [];
  const defaults = [{ id: "waialae", label: "Waialae · R1 H10" }];
  try {
    const filename = path.join(/*turbopackIgnore: true*/ process.cwd(), "tmp/shotcast-phase4c/proofs/index.json");
    const value: unknown = JSON.parse(await readFile(/*turbopackIgnore: true*/ filename, "utf8"));
    if (!Array.isArray(value)) return defaults;
    const choices = value.filter((p): p is DevelopmentProofChoice => p && typeof p.id === "string" && /^[a-z0-9-]+$/.test(p.id) && p.id !== "waialae" && typeof p.label === "string");
    if (new Set(choices.map(p => p.id)).size !== choices.length) return defaults;
    return [...defaults, ...choices.map(({ id, label }) => ({ id, label }))];
  } catch { return defaults; }
}
