import { Suspense } from "react";
import GolfLivePage from "@/components/golf/GolfLivePage";

export default function Page() {
  return <Suspense fallback={null}><GolfLivePage /></Suspense>;
}
