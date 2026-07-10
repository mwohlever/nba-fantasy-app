"use client";

import AppNav from "@/components/AppNav";
import { useEffect, useState } from "react";
import Link from "next/link";

type CurrentUser = {
  id: string;
  teamId: number;
  displayName: string;
  role: "player" | "admin";
};

export default function ProfilePage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      try {
        const response = await fetch("/api/me", {
          cache: "no-store",
        });

        const result = await response.json();

        if (response.ok && result.authenticated && result.user) {
          setUser(result.user as CurrentUser);
        }
      } catch (error) {
        console.error("Failed to load profile", error);
      } finally {
        setIsLoading(false);
      }
    }

    void loadUser();
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 pb-24 text-slate-900 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          {isLoading ? (
            <div className="text-sm text-slate-500">Loading profile...</div>
          ) : user ? (
            <>
              <div className="text-sm font-semibold uppercase tracking-wide text-sky-700">
                League Profile
              </div>

              <h1 className="mt-2 text-3xl font-bold tracking-tight">
                {user.displayName}
              </h1>

              <p className="mt-2 text-sm text-slate-600">
                Your full profile, career stats, awards, and notification settings
                will live here.
              </p>

              <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
                <div className="text-4xl">👤</div>
                <h2 className="mt-3 text-xl font-semibold">
                  Profile coming next
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Next we’ll reuse your existing team profile data here.
                </p>
              </div>
            </>
          ) : (
            <div className="text-center">
              <div className="text-4xl">🔒</div>
              <h1 className="mt-3 text-2xl font-bold">Login required</h1>
              <p className="mt-2 text-sm text-slate-600">
                Sign in to view your league profile.
              </p>

              <Link
                href="/login"
                className="mt-5 inline-block rounded-xl bg-sky-700 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-800"
              >
                Go to Login
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
