import { notFound } from "next/navigation";
import FixturePreview from "@/components/player-center/FixturePreview";
import type { PresentableHistory } from "@/lib/player-center/presentation";

export default async function PlayerCenterPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const capture: { histories: unknown[]; capturedAt: string; correctionsVerifiedAt?: string } = (await import("@/data/player-center-preview/captured.json")).default;
  return <FixturePreview histories={capture.histories as PresentableHistory[]} capturedAt={capture.capturedAt} correctionsVerifiedAt={capture.correctionsVerifiedAt} />;
}
