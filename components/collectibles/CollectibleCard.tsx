import type { ReactNode } from "react";

export type CollectibleRarity =
  | "common"
  | "rare"
  | "epic"
  | "legendary";

type CollectibleCardProps = {
  rarity: CollectibleRarity;
  locked?: boolean;
  featured?: boolean;
  className?: string;
  children: ReactNode;
};

export default function CollectibleCard({
  rarity,
  locked = false,
  featured = false,
  className = "",
  children,
}: CollectibleCardProps) {
  return (
    <article
      className={[
        "collectible-card",
        `collectible-card--${rarity}`,
        locked ? "collectible-card--locked" : "",
        featured ? "collectible-card--featured" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </article>
  );
}
