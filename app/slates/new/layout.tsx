import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function NewSlateLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role !== "admin") {
    redirect("/");
  }

  return children;
}
