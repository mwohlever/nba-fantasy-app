type FunFact = {
  label: string;
  value: string;
  detail?: string;
};

type Props = {
  facts: FunFact[];
};

export default function FunFactCarousel({ facts }: Props) {
  if (facts.length === 0) return null;

  const items = facts.map((fact) => {
    const detail = fact.detail ? ` — ${fact.detail}` : "";
    return `${fact.label}: ${fact.value}${detail}`;
  });

  const loopItems = [...items, ...items];

  return (
    <section className="overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 shadow-sm">
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-sky-800">
        🏀 Around the League
      </div>

      <div className="overflow-hidden text-sm text-slate-700">
        <div className="fun-fact-ticker flex w-max items-center gap-5 whitespace-nowrap">
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
          animation: fun-fact-scroll 45s linear infinite;
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
