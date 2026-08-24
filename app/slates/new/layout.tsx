import {
  redirect,
} from "next/navigation";

import {
  getCurrentUser,
} from "@/lib/auth";

import {
  getGroupContextForUser,
} from "@/lib/groups/context";


export default async function NewSlateLayout({
  children,
}: Readonly<{
  children:
    React.ReactNode;
}>) {
  const user =
    await getCurrentUser();


  if (!user) {
    redirect(
      "/login",
    );
  }


  if (
    user.systemRole ===
    "super_admin"
  ) {
    return children;
  }


  const context =
    await getGroupContextForUser(
      user,
    );


  if (
    !context?.isGroupAdmin
  ) {
    redirect(
      "/",
    );
  }


  return children;
}
