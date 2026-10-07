import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/** Explicit developer proof; unavailable in every production build. */
export default async function ShotcastPreparationProofPage({ searchParams }: { searchParams: Promise<{ proof?: string | string[] }> }) {
  if (process.env.NODE_ENV !== "development" || process.env.SHOTCAST_PREPARATION_PROOF !== "1") return notFound();
  const proof = (await searchParams).proof;
  if (Array.isArray(proof)) return notFound();
  const { readDevelopmentProof, readDevelopmentProofChoices } = await import("@/lib/shotcast/preparation/developmentProof.server");
  const replay = await readDevelopmentProof(proof);
  if (!replay) notFound();
  const { default: PreparationProof } = await import("@/components/lineups/GolfShotcastPreparationProof");
  return <PreparationProof replay={replay} choices={await readDevelopmentProofChoices()} activeProof={proof ?? "waialae"} />;
}
