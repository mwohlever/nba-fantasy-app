import { getSportConfig } from "@/lib/sports";

type FunFact = {
  label: string;
  value: string;
  detail?: string;
};

type Props = {
  facts: FunFact[];
  sport?: string;
};

const MIN_ITEMS_FOR_SMOOTH_LOOP = 8;

export default function FunFactCarousel({ facts, sport }: Props) {
  if (facts.length === 0) return null;

  const items = facts.map((fact) => {
    const detail = fact.detail ? ` — ${fact.detail}` : "";
    return `${fact.label}: ${fact.value}${detail}`;
  });

  const repeatCount = Math.max(
    Math.ceil(MIN_ITEMS_FOR_SMOOTH_LOOP / items.length),
    1
  );

  const paddedItems = Array.from({ length: repeatCount }, () => items).flat();
  const loopItems = [...paddedItems, ...paddedItems];
  const durationSeconds = Math.max(paddedItems.length * 3.2, 12);

  return (
    <section className="overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 shadow-sm">
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-sky-800">
        {getSportConfig(sport).emoji} Around the League
      </div>
      <div className="overflow-hidden text-sm text-slate-700">
        <div
          className="fun-fact-ticker flex w-max items-center gap-5 whitespace-nowrap"
          style={{ animationDuration: `${durationSeconds}s` }}
        >
          {loopItems.map((item, index) => (
            <span key={`${item}-${index}`}>
              {item}
              <span className="ml-5 text-sky-500">•</span>
            </span>
          ))}
        </div>
      </div>
      <style jsx>{`
        .fun-fact-ticker {
          animation-name: fun-fact-scroll;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        .fun-fact-ticker:hover {
          animation-play-state: paused;
        }
        @keyframes fun-fact-scroll {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </section>
  );
}
