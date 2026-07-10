"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Team = {
  id: number;
  name: string;
};

export default function LoginPage() {
  const router = useRouter();

  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [isLoadingTeams, setIsLoadingTeams] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function loadTeams() {
      try {
        const response = await fetch("/api/teams", {
          cache: "no-store",
        });

        const result = await response.json();

        if (!response.ok) {
          setMessage(result.error || "Failed to load league members.");
          return;
        }

        const safeTeams = (result.teams ?? []) as Team[];
        setTeams(safeTeams);

        if (safeTeams.length > 0) {
          setSelectedTeamId(String(safeTeams[0].id));
        }
      } catch (error) {
        console.error(error);
        setMessage("Failed to load league members.");
      } finally {
        setIsLoadingTeams(false);
      }
    }

    void loadTeams();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setIsSubmitting(true);
      setMessage("");

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          teamId: Number(selectedTeamId),
          pin,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Login failed.");
        return;
      }

      router.push("/");
      router.refresh();
    } catch (error) {
      console.error(error);
      setMessage("Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-4xl">🏀</div>

          <h1 className="mt-3 text-3xl font-bold tracking-tight">
            111 NBA Fantasy
          </h1>

          <p className="mt-2 text-sm text-slate-600">
            Choose your name and enter your league PIN.
          </p>
        </div>

        {message ? (
          <div className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
            {message}
          </div>
        ) : null}

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="team"
              className="mb-2 block text-sm font-semibold text-slate-700"
            >
              Who are you?
            </label>

            <select
              id="team"
              value={selectedTeamId}
              onChange={(event) => setSelectedTeamId(event.target.value)}
              disabled={isLoadingTeams}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="pin"
              className="mb-2 block text-sm font-semibold text-slate-700"
            >
              PIN
            </label>

            <input
              id="pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="current-password"
              value={pin}
              onChange={(event) =>
                setPin(event.target.value.replace(/\D/g, "").slice(0, 8))
              }
              placeholder="Enter PIN"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-center text-2xl font-bold tracking-[0.4em] outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
          </div>

          <button
            type="submit"
            disabled={
              isLoadingTeams ||
              isSubmitting ||
              !selectedTeamId ||
              pin.length < 4
            }
            className="w-full rounded-2xl bg-sky-700 px-4 py-3 font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Signing in..." : "Continue"}
          </button>
        </form>
      </section>
    </main>
  );
}
