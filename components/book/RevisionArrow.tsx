import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RevisionDirection } from "@/lib/types/db";

export function RevisionArrow({ dir }: { dir: RevisionDirection | string | null | undefined }) {
  if (dir === "up") return <ArrowUp className={cn("h-3.5 w-3.5 text-gain")} aria-label="Estimates revised up" />;
  if (dir === "down") return <ArrowDown className={cn("h-3.5 w-3.5 text-loss")} aria-label="Estimates revised down" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-label="Estimates unchanged" />;
}
