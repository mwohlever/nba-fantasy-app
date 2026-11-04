import { observationRecordFromNflObservation, resolveDirectNflIdentity, type NflEligiblePlayer, type NflObservationRecord, nflObservationFromUnknown } from "./observationIngestion";
import { nflSignedYardInputs } from "./observationFoundation";

export type NflObservationPersistenceRepository = {
  loadEligiblePlayers: () => Promise<NflEligiblePlayer[]>;
  existingHashes: (hashes: readonly string[]) => Promise<Set<string>>;
  insertVersions: (rows: readonly NflObservationRecord[]) => Promise<void>;
};

/** Batch is all-or-nothing at validation time; exact hash repeats are no-ops. */
export async function persistNflObservationBatch(input: { observations: readonly unknown[]; repository: NflObservationPersistenceRepository }) {
  if (!input.observations.length || input.observations.length > 500) throw new Error("NFL observation batch must contain 1–500 rows");
  const eligible = await input.repository.loadEligiblePlayers();
  const rows = input.observations.map(raw => {
    const observation = nflObservationFromUnknown(raw);
    // Prepared SQL is unapplied. Do not pass newly accepted signed facts to the
    // incompatible installed checks or silently convert them back to null/zero.
    if (Object.keys(nflSignedYardInputs(observation.stats)).length) throw new Error("NFL_SIGNED_YARDS_STORAGE_REVIEW_REQUIRED: signed facts retained by parser; approve schema and persistence capability before ingestion");
    const identity = resolveDirectNflIdentity({ providerPlayerId: observation.providerPlayerId, position: observation.position, eligible });
    if (observation.localPlayerId !== identity.localPlayerId) throw new Error(`NFL observation local player identity mismatch: ${observation.providerPlayerId}`);
    return observationRecordFromNflObservation(observation);
  });
  const hashes = rows.map(row => row.observation_hash), duplicateWithinBatch = hashes.length - new Set(hashes).size;
  if (duplicateWithinBatch) throw new Error("NFL observation batch repeats a factual version");
  const existing = await input.repository.existingHashes(hashes), inserts = rows.filter(row => !existing.has(row.observation_hash));
  if (inserts.length) await input.repository.insertVersions(inserts);
  return { received: rows.length, inserted: inserts.length, duplicate: rows.length - inserts.length, rejected: 0 };
}
