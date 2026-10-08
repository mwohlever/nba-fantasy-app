import Link from "next/link";
import InstallAppButton from "@/components/platform/InstallAppButton";
import PlatformAccountMenu from "@/components/platform/PlatformAccountMenu";
import PlatformGroupCard from "@/components/platform/PlatformGroupCard";
import { getCurrentUser } from "@/lib/auth";
import { getAvailableGroupContextsForUser, getGroupContextForUser } from "@/lib/groups/context";
import { PLATFORM_GAMES } from "@/lib/sports";

export const dynamic = "force-dynamic";

export default async function PlatformLandingPage() {
  const user = await getCurrentUser();
  const [activeContext, contexts] = user
    ? await Promise.all([
        getGroupContextForUser(user),
        getAvailableGroupContextsForUser(user),
      ])
    : [null, []];
  const groups = contexts
    .map((context) => ({
      id: context.group.id,
      name: context.group.name,
      slug: context.group.slug,
      role: context.membership.role,
      teamName: context.team?.name ?? null,
      isActive: context.group.id === activeContext?.group.id,
      leagues: context.leagues.map((league) => ({ id: league.id, sportKey: league.sportKey, name: league.name })),
    }))
    .sort((a, b) => Number(b.isActive) - Number(a.isActive));

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(45,212,191,0.10),_transparent_40%),linear-gradient(180deg,#07111f_0%,#020617_100%)] text-white">
      <div className="mx-auto max-w-4xl px-5 pb-8 pt-5 sm:px-8 sm:pt-8">
        <header className="flex items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <Link href="/" className="flex items-center gap-2.5" aria-label="111 Sports home">
            <span aria-hidden="true" className="font-mono text-2xl font-black tracking-tighter text-teal-300">111</span>
            <span className="text-sm font-black tracking-[0.16em]">SPORTS</span>
          </Link>
          {user ? (
            <PlatformAccountMenu
              displayName={user.displayName}
              avatarUrl={user.avatarUrl}
              groups={groups.map((group) => ({
                id: group.id,
                name: group.name,
                slug: group.slug,
                isActive: group.isActive,
              }))}
            />
          ) : (
            <Link href="/login" className="rounded-full border border-slate-700 px-4 py-2 text-sm font-bold transition hover:border-teal-300 hover:text-teal-300">Sign in</Link>
          )}
        </header>

        <section className="pb-10 pt-10 sm:pb-12 sm:pt-16">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-teal-300">The private clubhouse</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-black leading-[1.08] tracking-tight sm:text-6xl">
            Four friends.<br /> <span className="text-teal-300">Too many fantasy games.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">
            111 Sports is a private, noncommercial fantasy sports project for Mark, Jon, Josh, and Andy.
          </p>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
            A place for our drafts, standings, and friendly competition. Every season adds a little more history—and a few more reasons to bring up the last one.
          </p>
          <div className="mt-6 flex flex-wrap items-start gap-3">
            <Link href={user ? "#your-groups" : "/login"} className="inline-flex h-10 items-center justify-center rounded-full bg-teal-300 px-5 text-sm font-bold text-slate-950 transition hover:bg-teal-200">
              {user ? "Enter your Group →" : "Clubhouse sign in →"}
            </Link>
            <InstallAppButton />
          </div>
          <ul aria-label="The four friends" className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-800 pt-5 sm:gap-x-8">
            {["Mark", "Jon", "Josh", "Andy"].map((name) => (
              <li key={name} className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-teal-400" />{name}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="clubhouse-games" className="border-t border-slate-800 py-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="clubhouse-games" className="text-xl font-black tracking-tight">Our rotation</h2>
            <p className="text-xs text-slate-400">Different games. Same four friends.</p>
          </div>
          <div className="grid gap-x-8 sm:grid-cols-2">
            {PLATFORM_GAMES.map((game, index) => (
              <div key={game.key} className="flex items-start gap-3 border-t border-slate-800/80 py-4">
                <span aria-hidden="true" className="pt-0.5 font-mono text-[10px] text-teal-400">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="text-sm font-bold">{game.label}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{game.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="get-started" className="scroll-mt-6 border-t border-slate-800 py-6">
          <h2 className="text-lg font-black">The season changes. The rivalry stays.</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">Make your picks, check the standings, and revisit the wins you still talk about. Just a hobby project for our four-person crew.</p>
          {!user ? <p className="mt-3 text-xs text-slate-400">Have an account or an existing invitation? <Link href="/login" className="font-bold text-teal-300 hover:text-teal-200">Sign in →</Link></p> : null}
        </section>

        {user ? (
          <section id="your-groups" className="border-t border-slate-800 pt-8">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-widest text-teal-300">Welcome back, {user.displayName}</p><h2 className="mt-1 text-2xl font-black">Your Groups</h2></div>
            </div>
            {groups.length ? (
              <div className="grid gap-4 lg:grid-cols-2">{groups.map((group) => <PlatformGroupCard key={group.slug} group={group} />)}</div>
            ) : (
              <div className="rounded-3xl border border-slate-700 bg-slate-900/65 p-6">
                <h3 className="text-lg font-bold">You haven&apos;t joined a Group yet.</h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">Open your existing invitation link to find your Group and team.</p>
                <Link href="/profile?tab=settings" className="mt-4 inline-block text-sm font-semibold text-teal-300">Account settings →</Link>
              </div>
            )}
          </section>
        ) : null}

        <footer className="mt-6 flex flex-wrap justify-between gap-3 border-t border-slate-800 pt-5 text-xs text-slate-500">
          <p>111 Sports · Our games. Our history.</p>
          <a href="mailto:mark.wohlever@gmail.com" className="text-slate-400 transition hover:text-teal-300">Contact Mark</a>
        </footer>
      </div>
    </main>
  );
}
