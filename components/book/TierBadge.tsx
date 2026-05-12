import { cn } from "@/lib/utils";
import type { TickerTier } from "@/lib/types/db";

const TIER_CLASS: Record<TickerTier, string> = {
  1: "bg-tier1/15 text-tier1 border-tier1/40",
  2: "bg-tier2/15 text-tier2 border-tier2/40",
  3: "bg-tier3/15 text-tier3 border-tier3/40",
};

export function TierBadge({ tier, className }: { tier: TickerTier; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 w-7 items-center justify-center rounded-sm border text-[10px] font-bold tabular-nums",
        TIER_CLASS[tier],
        className,
      )}
    >
      T{tier}
    </span>
  );
}
