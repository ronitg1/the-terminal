// Hardcoded US macro event schedule used by the Earnings calendar overlay.
// Sourced from Federal Reserve / BLS publishing schedules at build time.
//
// MAINTENANCE: update this once a year (or when the Fed publishes the next
// year's FOMC dates). FOMC dates: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
// BLS economic releases:        https://www.bls.gov/schedule/news_release/

export type MacroEventKind = "FOMC" | "CPI" | "PPI" | "JOBS" | "GDP";

export interface MacroEvent {
  date: string; // ISO YYYY-MM-DD
  kind: MacroEventKind;
  label: string;
}

// US macro schedule for the next ~12 months. FOMC dates from federalreserve.gov.
// CPI / PPI / Jobs are published roughly monthly on standard cadences.
export const MACRO_EVENTS: ReadonlyArray<MacroEvent> = [
  // FOMC 2026
  { date: "2026-01-28", kind: "FOMC", label: "FOMC decision" },
  { date: "2026-03-18", kind: "FOMC", label: "FOMC decision + SEP" },
  { date: "2026-04-29", kind: "FOMC", label: "FOMC decision" },
  { date: "2026-06-17", kind: "FOMC", label: "FOMC decision + SEP" },
  { date: "2026-07-29", kind: "FOMC", label: "FOMC decision" },
  { date: "2026-09-16", kind: "FOMC", label: "FOMC decision + SEP" },
  { date: "2026-10-28", kind: "FOMC", label: "FOMC decision" },
  { date: "2026-12-09", kind: "FOMC", label: "FOMC decision + SEP" },

  // CPI 2026 (BLS releases — second Tue/Wed of each month, typical)
  { date: "2026-01-14", kind: "CPI", label: "CPI (Dec)" },
  { date: "2026-02-11", kind: "CPI", label: "CPI (Jan)" },
  { date: "2026-03-11", kind: "CPI", label: "CPI (Feb)" },
  { date: "2026-04-15", kind: "CPI", label: "CPI (Mar)" },
  { date: "2026-05-13", kind: "CPI", label: "CPI (Apr)" },
  { date: "2026-06-10", kind: "CPI", label: "CPI (May)" },
  { date: "2026-07-15", kind: "CPI", label: "CPI (Jun)" },
  { date: "2026-08-12", kind: "CPI", label: "CPI (Jul)" },
  { date: "2026-09-11", kind: "CPI", label: "CPI (Aug)" },
  { date: "2026-10-15", kind: "CPI", label: "CPI (Sep)" },
  { date: "2026-11-13", kind: "CPI", label: "CPI (Oct)" },
  { date: "2026-12-10", kind: "CPI", label: "CPI (Nov)" },

  // PPI 2026 (day after CPI typically)
  { date: "2026-05-14", kind: "PPI", label: "PPI (Apr)" },
  { date: "2026-06-11", kind: "PPI", label: "PPI (May)" },
  { date: "2026-07-16", kind: "PPI", label: "PPI (Jun)" },
  { date: "2026-08-13", kind: "PPI", label: "PPI (Jul)" },
  { date: "2026-09-10", kind: "PPI", label: "PPI (Aug)" },
  { date: "2026-10-14", kind: "PPI", label: "PPI (Sep)" },
  { date: "2026-11-12", kind: "PPI", label: "PPI (Oct)" },
  { date: "2026-12-09", kind: "PPI", label: "PPI (Nov)" },

  // Jobs / NFP 2026 (first Friday each month, typical)
  { date: "2026-05-01", kind: "JOBS", label: "Nonfarm Payrolls (Apr)" },
  { date: "2026-06-05", kind: "JOBS", label: "Nonfarm Payrolls (May)" },
  { date: "2026-07-02", kind: "JOBS", label: "Nonfarm Payrolls (Jun)" },
  { date: "2026-08-07", kind: "JOBS", label: "Nonfarm Payrolls (Jul)" },
  { date: "2026-09-04", kind: "JOBS", label: "Nonfarm Payrolls (Aug)" },
  { date: "2026-10-02", kind: "JOBS", label: "Nonfarm Payrolls (Sep)" },
  { date: "2026-11-06", kind: "JOBS", label: "Nonfarm Payrolls (Oct)" },
  { date: "2026-12-04", kind: "JOBS", label: "Nonfarm Payrolls (Nov)" },
];

export function getMacroInRange(fromIso: string, toIso: string): MacroEvent[] {
  return MACRO_EVENTS.filter((e) => e.date >= fromIso && e.date <= toIso);
}
