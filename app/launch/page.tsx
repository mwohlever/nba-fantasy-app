import { redirect } from "next/navigation";
import AppResumeLaunch from "@/components/platform/AppResumeLaunch";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LaunchPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <AppResumeLaunch />;
}
