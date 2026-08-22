"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import AppNav from "@/components/AppNav";
import { useGroupContext } from "@/components/providers/GroupProvider";

export default function PlatformAdminPage() {
  const router = useRouter();

  const {
    groupContext,
    isLoading,
  } = useGroupContext();

  const isSuperAdmin =
    Boolean(
      groupContext?.isSuperAdmin,
    );

  useEffect(() => {
    if (
      !isLoading &&
      !isSuperAdmin
    ) {
      router.replace(
        "/admin",
      );
    }
  }, [
    isLoading,
    isSuperAdmin,
    router,
  ]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <AppNav />

        {isLoading ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            Loading platform controls…
          </section>
        ) : !isSuperAdmin ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            Redirecting to Commissioner Center…
          </section>
        ) : (
          <>
            <section className="rounded-3xl border border-violet-200 bg-white p-6 shadow-sm">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-violet-600">
                111 Sports
              </div>

              <h1 className="mt-2 text-3xl font-bold tracking-tight">
                Super Admin Center
              </h1>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Manage platform-wide Groups, access, administrators, and system operations.
              </p>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold">
                Groups & Access
              </h2>

              <p className="mt-1 text-sm text-slate-600">
                Create and manage Groups, assign administrators, control enabled games, and manage membership access.
              </p>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Link
                  href="/admin/groups"
                  className="group rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:border-violet-400 hover:bg-violet-50"
                >
                  <h3 className="font-semibold text-slate-950">
                    Manage Groups
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Create Groups, assign Group administrators, manage members, invitations, enabled games, and Group lifecycle.
                  </p>

                  <div className="mt-4 text-sm font-semibold text-violet-700">
                    Open →
                  </div>
                </Link>
              </div>
            </section>

          </>
        )}
      </div>
    </main>
  );
}
