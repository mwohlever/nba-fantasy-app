import { notFound } from "next/navigation";
import BracketTournamentSimulation from "@/components/bracket/BracketTournamentSimulation";
import { simulationAvailable } from "@/lib/bracket/simulation";

export const dynamic = "force-dynamic";

export default function CfpSimulationPage() {
  if (!simulationAvailable(process.env.NODE_ENV)) notFound();
  return <BracketTournamentSimulation />;
}
