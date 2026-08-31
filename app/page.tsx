import Link from "next/link";
import Image from "next/image";
import InstallAppButton from "@/components/platform/InstallAppButton";
import PlatformGroupCard from "@/components/platform/PlatformGroupCard";
import ProductShowcase from "@/components/platform/ProductShowcase";
import TeamAvatar from "@/components/ui/TeamAvatar";
import { getCurrentUser } from "@/lib/auth";
import { getAvailableGroupContextsForUser, getGroupContextForUser } from "@/lib/groups/context";

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
      name: context.group.name,
      slug: context.group.slug,
      role: context.membership.role,
      teamName: context.team?.name ?? null,
      isActive: context.group.id === activeContext?.group.id,
      leagues: context.leagues.map((league) => ({ id: league.id, sportKey: league.sportKey, name: league.name })),
    }))
    .sort((a, b) => Number(b.isActive) - Number(a.isActive));

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(45,212,191,0.15),_transparent_32%),linear-gradient(180deg,#07111f_0%,#020617_100%)] text-white">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-5 sm:px-6 sm:pt-8">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/logos/logo_all_sports.png" alt="111 Sports" width={48} height={48} priority className="h-12 w-12 rounded-full object-cover shadow-lg shadow-teal-950" />
            <span className="text-lg font-black tracking-tight">111 SPORTS</span>
          </Link>
          <div className="flex items-center gap-2 text-sm">
            {user ? (
              <Link href="/profile?tab=overview" className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 py-1.5 pl-1.5 pr-3 font-semibold text-slate-200 transition hover:border-teal-400">
                <TeamAvatar teamName={user.displayName} avatarUrl={user.avatarUrl} size="sm" />
                <span className="max-w-28 truncate">{user.displayName}</span>
              </Link>
            ) : (
              <Link href="/login" className="rounded-full bg-teal-300 px-4 py-2 font-bold text-slate-950">Sign in</Link>
            )}
          </div>
        </header>

        <section className="grid gap-7 pb-10 pt-14 md:grid-cols-[0.9fr_1.1fr] md:items-center md:pb-16 md:pt-20">
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-teal-300">Play together. Keep score.</p>
            <h1 className="max-w-3xl text-4xl font-black leading-[1.03] tracking-tight sm:text-6xl">Fantasy sports for you and your friends.</h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">Draft against your friends at your own pace. Compete all season. Keep the standings, stats, trophies, and history forever.</p>
            <div className="mt-6 grid max-w-lg grid-cols-2 gap-x-5 gap-y-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-100 sm:text-[11px]">
              {[["↻", "Daily Snake Drafts"], ["●", "Live Scoring"], ["▥", "Standings & Stats"], ["🏆", "History & Trophies"]].map(([icon, label]) => <div key={label} className="flex items-center gap-2"><span aria-hidden="true" className="flex w-4 justify-center text-sm text-teal-300">{icon}</span><span>{label}</span></div>)}
            </div>
            <div className="mt-7 flex flex-wrap items-start gap-3">
              <Link href="#get-started" className="inline-flex h-10 items-center justify-center rounded-full bg-teal-300 px-5 text-sm font-bold text-slate-950 transition hover:bg-teal-200">Get Started</Link>
              <InstallAppButton />
            </div>
          </div>
          <ProductShowcase />
        </section>

        <section className="mb-10 flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/45 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-teal-300">More ways to compete</p><p className="mt-1 text-sm text-slate-300">Not every rivalry needs a fantasy draft.</p></div>
          <div className="flex flex-wrap gap-2 text-sm font-semibold"><span className="rounded-full bg-slate-800 px-3 py-2">🏈 NCAA Football Pick&apos;em</span><span className="rounded-full bg-slate-800 px-3 py-2">🏀 NBA Skins</span></div>
        </section>

        <section id="get-started" className="mb-10 scroll-mt-6 border-y border-slate-800 py-8">
          <div className="mb-6"><p className="text-xs font-black uppercase tracking-[0.2em] text-teal-300">Get Started</p><h2 className="mt-2 text-2xl font-black text-white">Your Group starts with an invitation.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">New Groups are currently set up through 111 Sports. Once created, a commissioner invites each member by email.</p></div>
          <div className="grid gap-5 md:grid-cols-3 md:gap-0 lg:grid-cols-[max-content_minmax(0,1fr)_minmax(0,1fr)]">
            {[
              ["01", "Get your invitation", "Ask your commissioner for an email invitation."],
              ["02", "Open your link", "Create or connect your account; your membership and team are set up automatically."],
              ["03", "Sign in & compete", "Enter your Group and start drafting across its enabled games."],
            ].map(([number, title, description], index) => <div key={number} className={`relative min-w-0 ${index ? "md:border-l md:border-slate-800 md:pl-5" : ""} ${index < 2 ? "md:pr-5" : ""} ${index === 0 ? "lg:pr-8" : ""}`}><p className="text-[10px] font-black tracking-[0.18em] text-teal-400">STEP {number}</p><h3 className="mt-2 font-bold text-white">{title}</h3><p className={`mt-1 text-sm leading-6 text-slate-400 ${index === 0 ? "lg:whitespace-nowrap" : ""}`}>{description}</p></div>)}
          </div>
          {!user ? <p className="mt-6 text-sm text-slate-400">Already have an account or invitation? <Link href="/login" className="font-bold text-teal-300 hover:text-teal-200">Sign in →</Link></p> : null}
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
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">111 Sports is Group-based. Open the invitation link sent by your commissioner to join; there is no public league directory.</p>
                <Link href="/profile?tab=settings" className="mt-4 inline-block text-sm font-semibold text-teal-300">Account settings →</Link>
              </div>
            )}
          </section>
        ) : (
          <section className="border-t border-slate-800 pt-8 text-sm text-slate-300"><p>Joining is invitation-based. Use the link from your Group commissioner, or sign in to an existing account.</p></section>
        )}
      </div>
    </main>
  );
}
