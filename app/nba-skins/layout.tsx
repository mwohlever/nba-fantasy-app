import { Suspense } from "react";

export default function NbaSkinsLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<p className="p-4 text-sm">Loading NBA Skins…</p>}>{children}</Suspense>;
}
