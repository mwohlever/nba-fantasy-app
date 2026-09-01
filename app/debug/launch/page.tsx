import { redirect } from "next/navigation";
import LaunchDebugPage from "@/components/platform/LaunchDebugPage";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LaunchDebugRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <LaunchDebugPage />;
}
