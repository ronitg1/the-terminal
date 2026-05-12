import YahooFinance from "yahoo-finance2";
const yahooFinance: any = new (YahooFinance as any)();

export interface NextEarnings {
  symbol: string;
  earningsDate: string | null; // ISO date (next upcoming if multiple)
  timing: "BH" | "AH" | null;
  daysUntil: number | null;
}

export async function getNextEarnings(symbol: string): Promise<NextEarnings> {
  const blank: NextEarnings = { symbol, earningsDate: null, timing: null, daysUntil: null };
  try {
    const summary = await yahooFinance.quoteSummary(symbol, { modules: ["calendarEvents"] });
    const e = summary?.calendarEvents?.earnings ?? {};
    const dates: unknown[] = e.earningsDate ?? [];
    const now = Date.now();
    const upcoming = dates
      .map((d) => (d instanceof Date ? d : new Date(d as string | number)))
      .filter((d) => !Number.isNaN(d.getTime()) && d.getTime() >= now - 86400000)
      .sort((a, b) => a.getTime() - b.getTime());
    if (upcoming.length === 0) return blank;
    const next = upcoming[0];
    return {
      symbol,
      earningsDate: next.toISOString().slice(0, 10),
      timing: typeof e.isDateConfirmed === "boolean" ? null : null, // Yahoo doesn't reliably surface BH/AH
      daysUntil: Math.round((next.getTime() - now) / 86400000),
    };
  } catch (err) {
    console.error("getNextEarnings error", symbol, err);
    return blank;
  }
}
