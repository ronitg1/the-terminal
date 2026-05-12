"use client";

import useSWR from "swr";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Resp { symbols: string[]; matrix: number[][] }
const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function CorrelationHeatmap() {
  const { data, error, isLoading, mutate } = useSWR<Resp>("/api/correlations", fetcher, {
    refreshInterval: 0,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  if (isLoading) return <Placeholder text="Computing correlations…" />;
  if (error || !data || !Array.isArray(data.symbols) || data.symbols.length < 2) {
    return (
      <Placeholder
        text="Need at least 2 tickers with price history for a correlation matrix."
        onRetry={() => mutate()}
      />
    );
  }

  const { symbols, matrix } = data;
  const cell = 28;
  const labelCol = 48;
  const labelRow = 18;

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">60-day correlation</div>
      <TooltipProvider delayDuration={50}>
        <div className="overflow-auto">
          <svg
            width={labelCol + symbols.length * cell}
            height={labelRow + symbols.length * cell}
            className="font-mono text-[10px]"
          >
            {symbols.map((s, j) => (
              <text key={`col-${s}`} x={labelCol + j * cell + cell / 2} y={labelRow - 4} textAnchor="middle" fill="hsl(var(--muted-foreground))">{s}</text>
            ))}
            {symbols.map((s, i) => (
              <text key={`row-${s}`} x={labelCol - 4} y={labelRow + i * cell + cell / 2 + 3} textAnchor="end" fill="hsl(var(--muted-foreground))">{s}</text>
            ))}
            {matrix.map((row, i) =>
              row.map((v, j) => (
                <Tooltip key={`${i}-${j}`}>
                  <TooltipTrigger asChild>
                    <rect
                      x={labelCol + j * cell}
                      y={labelRow + i * cell}
                      width={cell - 1}
                      height={cell - 1}
                      fill={colorFor(v)}
                      stroke="hsl(var(--background))"
                      strokeWidth={1}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <div className="text-[11px]">
                      <span className="font-semibold">{symbols[i]} · {symbols[j]}</span>
                      <span className="ml-2 tabular-nums">{v.toFixed(2)}</span>
                    </div>
                  </TooltipContent>
                </Tooltip>
              )),
            )}
          </svg>
        </div>
      </TooltipProvider>
    </div>
  );
}

function Placeholder({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-dashed p-4 text-xs text-muted-foreground">
      <span>{text}</span>
      {onRetry && (
        <button onClick={onRetry} className="rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-wider hover:bg-accent">
          Refresh
        </button>
      )}
    </div>
  );
}

// Diverging color scale: red (negative) ↔ neutral (0) ↔ green (positive)
function colorFor(v: number): string {
  const x = Math.max(-1, Math.min(1, v));
  if (x >= 0) {
    const a = x; // 0..1
    return `hsl(142 64% ${Math.round(95 - a * 55)}%)`;
  }
  const a = -x;
  return `hsl(0 72% ${Math.round(95 - a * 55)}%)`;
}
