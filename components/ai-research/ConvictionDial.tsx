import { cn } from "@/lib/utils";

export function ConvictionDial({ value, className }: { value: number | null; className?: string }) {
  const v = value ?? 0;
  const pct = Math.max(0, Math.min(1, v / 10));
  const radius = 18;
  const stroke = 4;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * pct;
  const color =
    v >= 8 ? "hsl(var(--tier1))" : v >= 6 ? "hsl(var(--gain))" : v >= 4 ? "hsl(45 90% 55%)" : "hsl(var(--loss))";

  return (
    <div className={cn("relative inline-flex h-12 w-12 items-center justify-center", className)}>
      <svg width="48" height="48" viewBox="0 0 48 48" className="-rotate-90">
        <circle cx="24" cy="24" r={radius} stroke="hsl(var(--muted))" strokeWidth={stroke} fill="none" />
        <circle
          cx="24"
          cy="24"
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute text-[11px] font-semibold tabular-nums">{value == null ? "—" : value}</div>
    </div>
  );
}
