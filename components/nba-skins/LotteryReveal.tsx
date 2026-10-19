"use client";

import styles from "./LotteryReveal.module.css";

export type LotterySlot = { pick: number; name: string | null };

export default function LotteryReveal({
  seasonLabel, rounds, slots, nextPick, run, busy, canEdit, persistence, saveLabel, error,
  onShow, onRestart, onClear, onExit, onSave, onVerify,
}: {
  seasonLabel: string; rounds: number; slots: LotterySlot[]; nextPick: number | null;
  run: number; busy: boolean; canEdit: boolean;
  persistence: "proposed" | "verifying" | "saved";
  saveLabel: string; error: string;
  onShow: (pick: number) => void; onRestart: () => void; onClear: () => void;
  onExit: () => void; onSave: () => void; onVerify: () => void;
}) {
  const complete = nextPick === null;
  return (
    <main className={styles.lotteryPage}>
      <section className={styles.lotteryStage} aria-label="NBA Skins draft lottery">
        <header className={styles.lotteryHeader}>
          <div>
            <p className={styles.lotteryEyebrow}>NBA Skins · {seasonLabel}</p>
            <h1>Draft lottery</h1>
            <p className={styles.lotteryFormat}>{slots.length} participants · {rounds}-round snake</p>
          </div>
          <button type="button" className={styles.lotteryTextButton} onClick={onExit} disabled={busy}>Exit reveal</button>
        </header>

        <div className={styles.lotteryControls}>
          <button key={run} type="button" disabled className={`${styles.lotteryRandomize} ${styles.lotteryRandomized}`}>
            Randomize Order <span aria-hidden="true">✓</span>
          </button>
          <div className={styles.lotterySecondary}>
            <button type="button" onClick={onRestart} disabled={busy || !canEdit} className={styles.lotteryTextButton}>Restart lottery</button>
            <button type="button" onClick={onClear} disabled={busy || !canEdit || persistence !== "proposed"} className={styles.lotteryTextButton}>Clear Draft Order</button>
          </div>
        </div>

        <div role="status" aria-live="polite" aria-atomic="true" className={`${styles.lotteryAnnouncement} ${complete ? styles.lotteryComplete : ""}`}>
          {complete ? "Draft order revealed!" : nextPick === slots.length
            ? "Order randomized! Ready for the reveal." : `Next up: Pick #${nextPick}`}
        </div>

        <ol className={styles.lotterySlots} aria-label="Draft positions, last pick to first">
          {slots.map(({ pick, name }) => (
            <li key={pick} className={`${styles.lotteryCard} ${name ? styles.lotteryRevealed : ""} ${pick === 1 ? styles.lotteryFirstPick : ""}`}>
              <span className={styles.lotteryPick}>PICK <strong>#{pick}</strong></span>
              <span className={styles.lotteryName} key={name ? "revealed" : "hidden"} aria-live="polite" aria-atomic="true">{name ?? "???"}</span>
              <button type="button" className={styles.lotteryShow} disabled={busy || pick !== nextPick || !canEdit}
                aria-label={`Show Pick #${pick}`} onClick={() => onShow(pick)}>
                {name ? <span aria-label="Revealed">✓</span> : "Show"}
              </button>
            </li>
          ))}
        </ol>

        <footer className={styles.lotteryFooter}>
          <p role="status" className={styles.lotterySaveStatus}>
            {persistence === "saved" ? "Saved order · verified after reload." : persistence === "verifying"
              ? "Save accepted · checking the saved order…" : complete ? "Unsaved proposal · ready to save." : `Unsaved proposal · reveal all ${slots.length} picks to save.`}
          </p>
          {error ? <p role="alert" className={styles.lotteryError}>{error}</p> : null}
          {persistence === "verifying" && !busy ? (
            <button type="button" className={styles.lotterySave} onClick={onVerify}>Verify saved order</button>
          ) : (
            <button type="button" className={styles.lotterySave} disabled={busy || !canEdit || !complete || persistence !== "proposed"} onClick={onSave}>
              {busy ? "Saving…" : persistence === "saved" ? "Order saved" : saveLabel}
            </button>
          )}
          <p className={styles.lotteryNote}>Randomized on this device. The recording is not independent proof of the draw.</p>
          <p className={styles.lotteryNote}>Clear discards an unsaved proposal. A saved order cannot be deleted here because its participants are frozen.</p>
        </footer>
      </section>
    </main>
  );
}
