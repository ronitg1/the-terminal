// Industry frames: per-sector context for the agent. Each frame defines the
// benchmark ETF, the policy themes that matter, and a persona prefix the
// system prompt uses. Auto-picked from a ticker's Yahoo sector/industry; can
// be overridden per-ticker via tickers.frame_id / tickers.benchmark_symbol.

export interface IndustryFrame {
  id: string;
  label: string;
  benchmarkSymbol: string;       // ETF used for relative-return + chat context
  benchmarkLabel: string;
  personaContext: string;        // appended to the analyst persona in system prompts
  policyThemes: string[];        // surfaced to the news analyst
  domainKnowledge: string[];     // listed in the system prompt so the model can assume it
  keyMetrics: string[];          // metrics that matter for this sector (used in prompts)
  defaultTickers: string[];      // representative names — shown in the news tab when the user has none in this sector
}

export const FRAMES: Record<string, IndustryFrame> = {
  "energy-transition": {
    id: "energy-transition",
    label: "Energy transition",
    benchmarkSymbol: "ICLN",
    benchmarkLabel: "iShares Global Clean Energy",
    personaContext:
      "an energy-transition specialist (solar manufacturing, battery storage, EV charging, grid). Your reader has clean-energy exposure in their book.",
    policyThemes: [
      "IRA 45X advanced manufacturing PTC",
      "48E ITC and 6418 transferability",
      "FEOC compliance / domestic content adders",
      "Section 201 / 301 solar tariffs",
      "Treasury 45X guidance",
      "interconnection queue reform",
    ],
    domainKnowledge: [
      "polysilicon → wafer → cell → module economics",
      "battery storage system IRRs and revenue stacks",
      "EV charger utilization curves and network density",
      "prevailing-wage / apprenticeship adders",
    ],
    keyMetrics: ["module ASPs ($/W)", "gross margin trajectory", "PTC monetization terms", "shipment volume", "bookings backlog"],
    defaultTickers: ["FSLR", "ENPH", "NXT", "ARRY", "SHLS", "CHPT", "PLUG"],
  },

  "tech-semis": {
    id: "tech-semis",
    label: "Technology / Semiconductors",
    benchmarkSymbol: "SOXX",
    benchmarkLabel: "iShares Semiconductor ETF",
    personaContext:
      "a tech / semiconductors specialist focused on AI infrastructure, datacenter capex, foundry capacity, and the memory cycle.",
    policyThemes: [
      "CHIPS Act funding and conditions",
      "export controls on advanced chips to China",
      "China retaliatory measures",
      "tariff regime changes",
    ],
    domainKnowledge: [
      "AI training/inference compute demand curves",
      "HBM/DRAM supply discipline and pricing",
      "TSMC / SK Hynix / Samsung capacity allocations",
      "datacenter buildout pipeline and power constraints",
    ],
    keyMetrics: ["datacenter revenue growth", "gross margin", "AI/non-AI revenue mix", "capex intensity", "design-win pipeline"],
    defaultTickers: ["NVDA", "AMD", "AVGO", "TSM", "MU", "INTC", "ASML", "AMAT"],
  },

  "mega-tech": {
    id: "mega-tech",
    label: "Mega-cap tech (platforms)",
    benchmarkSymbol: "QQQ",
    benchmarkLabel: "Invesco QQQ (Nasdaq-100)",
    personaContext:
      "a platforms / mega-cap tech analyst focused on ad markets, cloud growth, AI capex returns, and regulatory overhang.",
    policyThemes: ["FTC/DOJ antitrust enforcement", "EU DMA / DSA", "AI regulation", "Section 230 changes", "data privacy"],
    domainKnowledge: ["ad market share dynamics", "cloud growth and margin trajectories", "AI capex ROIC", "App Store / Play Store economics"],
    keyMetrics: ["ad revenue ex-FX", "cloud revenue growth", "capex / depreciation", "operating margin", "buybacks"],
    defaultTickers: ["AAPL", "MSFT", "GOOGL", "META", "AMZN", "NFLX"],
  },

  "banks": {
    id: "banks",
    label: "Banks / Financials",
    benchmarkSymbol: "XLF",
    benchmarkLabel: "Financial Select Sector SPDR",
    personaContext:
      "a banks / capital markets analyst focused on NII sensitivity, credit quality, capital adequacy, and trading revenue.",
    policyThemes: ["Fed rate path", "Basel III endgame", "Dodd-Frank / G-SIB capital", "stress test results", "CFPB enforcement"],
    domainKnowledge: ["NII walk-throughs", "deposit beta dynamics", "CRE / consumer credit normalization", "capital return capacity"],
    keyMetrics: ["NII growth", "NIM", "efficiency ratio", "CET1 ratio", "NCO rate", "loan growth"],
    defaultTickers: ["JPM", "BAC", "GS", "MS", "WFC", "C", "SCHW"],
  },

  "healthcare": {
    id: "healthcare",
    label: "Healthcare",
    benchmarkSymbol: "XLV",
    benchmarkLabel: "Health Care Select Sector SPDR",
    personaContext:
      "a healthcare analyst familiar with biotech catalysts, drug pricing dynamics, managed care, and medical devices.",
    policyThemes: ["IRA drug pricing negotiations", "Medicare Advantage rates", "FDA approval timelines", "PBM regulation"],
    domainKnowledge: ["clinical trial readout dynamics", "patent cliff exposure", "MA/PDP risk adjustment", "PBM rebate economics"],
    keyMetrics: ["product-level revenue", "MLR (managed care)", "clinical readout dates", "patent expirations", "pipeline NPV"],
    defaultTickers: ["LLY", "UNH", "JNJ", "PFE", "MRK", "ABBV", "BMY"],
  },

  "consumer": {
    id: "consumer",
    label: "Consumer",
    benchmarkSymbol: "XLY",
    benchmarkLabel: "Consumer Discretionary Select Sector SPDR",
    personaContext:
      "a consumer / retail analyst focused on same-store sales, unit economics, brand health, and tariff exposure.",
    policyThemes: ["tariffs on imported goods", "labor / wage dynamics", "credit availability for consumers"],
    domainKnowledge: ["same-store sales decomposition (traffic vs ticket)", "DTC vs wholesale margin profiles", "promotional cadence"],
    keyMetrics: ["comp sales", "gross margin", "store count", "inventory days", "AUR"],
    defaultTickers: ["TSLA", "HD", "MCD", "NKE", "SBUX", "LOW", "TGT", "WMT"],
  },

  "industrials": {
    id: "industrials",
    label: "Industrials",
    benchmarkSymbol: "XLI",
    benchmarkLabel: "Industrial Select Sector SPDR",
    personaContext: "an industrials analyst tracking capex cycles, PMI dynamics, aerospace orders, and infrastructure spend.",
    policyThemes: ["infrastructure bill spend", "defense budget", "tariff regime", "supply-chain resiliency policy"],
    domainKnowledge: ["aerospace OEM build rates", "non-resi construction cycle", "automation capex", "freight cycle"],
    keyMetrics: ["organic revenue growth", "book-to-bill", "operating margin", "backlog"],
    defaultTickers: ["BA", "CAT", "HON", "DE", "GE", "ETN", "EMR"],
  },

  "energy-traditional": {
    id: "energy-traditional",
    label: "Traditional energy (O&G)",
    benchmarkSymbol: "XLE",
    benchmarkLabel: "Energy Select Sector SPDR",
    personaContext:
      "a traditional energy / O&G analyst focused on production cadence, capital discipline, well economics, and commodity exposure.",
    policyThemes: ["OPEC+ production decisions", "SPR releases", "permitting policy", "LNG export approvals"],
    domainKnowledge: ["Permian / Bakken well productivity curves", "decline rates", "midstream takeaway capacity", "refining cracks"],
    keyMetrics: ["production growth", "capex / EBITDA", "FCF yield", "shareholder return %", "breakeven prices"],
    defaultTickers: ["XOM", "CVX", "COP", "EOG", "SLB", "PSX", "MPC"],
  },

  "generalist": {
    id: "generalist",
    label: "Generalist",
    benchmarkSymbol: "SPY",
    benchmarkLabel: "S&P 500",
    personaContext: "a generalist equity analyst covering this name. Use fundamental drivers specific to the industry; don't force a sector-specific framing.",
    policyThemes: [],
    domainKnowledge: [],
    keyMetrics: ["revenue growth", "operating margin", "FCF conversion", "capital return"],
    defaultTickers: [],
  },
};

// Sectors shown as selectable in the News tab — excludes "generalist" which is a
// fallback bucket rather than a real sector.
export const SECTOR_FRAME_IDS = [
  "energy-transition",
  "tech-semis",
  "mega-tech",
  "banks",
  "healthcare",
  "consumer",
  "industrials",
  "energy-traditional",
] as const;

const SECTOR_PATTERNS: Array<{ id: keyof typeof FRAMES; sector?: RegExp; industry?: RegExp }> = [
  // Energy transition takes precedence — match clean-energy industries first.
  { id: "energy-transition", industry: /\b(solar|renewable|wind|hydrogen|fuel cell|ev charging|electric vehicle|battery|energy storage|grid)\b/i },
  { id: "tech-semis", industry: /\b(semiconductor|software|cloud|cybersecurity|electronic gaming)\b/i },
  { id: "mega-tech", industry: /\b(internet content|interactive media|communication services|consumer electronics)\b/i },
  { id: "banks", industry: /\b(bank|capital market|insurance|financial)\b/i },
  { id: "banks", sector: /^financial/i },
  { id: "healthcare", sector: /^healthcare/i },
  { id: "consumer", sector: /^consumer (cyclical|defensive)/i },
  { id: "industrials", sector: /^industrials/i },
  { id: "energy-traditional", sector: /^energy/i },
];

export function pickFrame(sector: string | null | undefined, industry: string | null | undefined): IndustryFrame {
  for (const rule of SECTOR_PATTERNS) {
    if (rule.industry && industry && rule.industry.test(industry)) return FRAMES[rule.id];
    if (rule.sector && sector && rule.sector.test(sector)) return FRAMES[rule.id];
  }
  return FRAMES.generalist;
}

export function getFrameById(id: string | null | undefined): IndustryFrame | null {
  if (!id) return null;
  return FRAMES[id as keyof typeof FRAMES] ?? null;
}
