import YahooFinance from "yahoo-finance2";
const yahooFinance: any = new (YahooFinance as any)();

export interface ImpliedMove {
  symbol: string;
  spot: number | null;
  expiry: string | null;
  atmStraddlePrice: number | null;
  impliedMovePct: number | null;
}

export interface ContractQuote {
  strike: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  lastPrice: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
}

export interface ContractsForExpiry {
  symbol: string;
  expiry: string;
  daysToExpiry: number;
  spot: number;
  atmStrike: number;
  atmCall: ContractQuote | null;
  atmPut: ContractQuote | null;
  // A few OTM strikes either side of ATM (for spread structures).
  callsNearAtm: ContractQuote[];
  putsNearAtm: ContractQuote[];
}

export interface ContractActivity {
  type: "call" | "put";
  strike: number;
  expiry: string;
  daysToExpiry: number;
  volume: number;
  openInterest: number;
  volOiRatio: number;       // volume / max(openInterest,1)
  mid: number | null;
  impliedVolatility: number | null;
  notionalUsd: number | null; // mid * volume * 100
}

export interface ChainSummary {
  symbol: string;
  spot: number | null;
  expiry: string | null;       // expiry used for the front-of-book aggregate
  daysToExpiry: number | null;
  callVolume: number;
  putVolume: number;
  callOpenInterest: number;
  putOpenInterest: number;
  callNotionalUsd: number;     // estimated $ premium traded today on calls (front expiry)
  putNotionalUsd: number;
  callPutVolumeRatio: number | null;    // null if put vol is 0
  callPutOiRatio: number | null;
  atmIv: number | null;        // mid of ATM call & put IV — front expiry
  notableContracts: ContractActivity[]; // top 5 by volume/OI with volume threshold
  asOf: string;                // ISO timestamp when computed
}

export interface OptionsProvider {
  impliedMove(symbol: string): Promise<ImpliedMove>;
  expiries(symbol: string): Promise<string[]>;
  contractsForExpiry(symbol: string, expiryDateIso?: string): Promise<ContractsForExpiry | null>;
  chainSummary(symbol: string, expiryDateIso?: string): Promise<ChainSummary | null>;
}

class YahooOptionsProvider implements OptionsProvider {
  async expiries(symbol: string): Promise<string[]> {
    try {
      const opts = await yahooFinance.options(symbol);
      const dates: unknown[] = opts.expirationDates ?? [];
      return dates
        .map((d) => (d instanceof Date ? d : new Date(d as string | number)))
        .filter((d) => !Number.isNaN(d.getTime()))
        .map((d) => d.toISOString().slice(0, 10));
    } catch (err) {
      console.error("YahooOptionsProvider.expiries error", symbol, err);
      return [];
    }
  }

  async contractsForExpiry(symbol: string, expiryDateIso?: string): Promise<ContractsForExpiry | null> {
    try {
      const queryOpts = expiryDateIso ? { date: new Date(expiryDateIso) } : {};
      const opts = await yahooFinance.options(symbol, queryOpts);
      const spot = (opts as any).quote?.regularMarketPrice ?? null;
      if (!spot || !opts.options || opts.options.length === 0) return null;

      const chain = opts.options[0];
      const expiry =
        chain.expirationDate instanceof Date
          ? chain.expirationDate.toISOString().slice(0, 10)
          : String(chain.expirationDate);
      const daysToExpiry = Math.max(0, Math.round((new Date(expiry).getTime() - Date.now()) / 86400000));

      const calls = (chain.calls ?? []) as any[];
      const puts = (chain.puts ?? []) as any[];
      if (calls.length === 0 || puts.length === 0) return null;

      const closest = (rows: any[]) =>
        rows.reduce((best, c) =>
          Math.abs((c.strike ?? Infinity) - spot) < Math.abs((best.strike ?? Infinity) - spot) ? c : best,
        );
      const atmCall = closest(calls);
      const atmPut = closest(puts);
      const atmStrike = atmCall.strike ?? atmPut.strike;

      // Three strikes either side of ATM for spread structures.
      const sortedCalls = [...calls].sort((a, b) => a.strike - b.strike);
      const sortedPuts = [...puts].sort((a, b) => a.strike - b.strike);
      const atmCallIdx = sortedCalls.findIndex((c) => c.strike === atmStrike);
      const atmPutIdx = sortedPuts.findIndex((p) => p.strike === atmStrike);
      const slice = <T,>(arr: T[], center: number, w = 3): T[] =>
        arr.slice(Math.max(0, center - w), Math.min(arr.length, center + w + 1));

      return {
        symbol,
        expiry,
        daysToExpiry,
        spot,
        atmStrike,
        atmCall: toContractQuote(atmCall),
        atmPut: toContractQuote(atmPut),
        callsNearAtm: slice(sortedCalls, atmCallIdx).map(toContractQuote).filter((c): c is ContractQuote => c !== null),
        putsNearAtm: slice(sortedPuts, atmPutIdx).map(toContractQuote).filter((c): c is ContractQuote => c !== null),
      };
    } catch (err) {
      console.error("YahooOptionsProvider.contractsForExpiry error", symbol, err);
      return null;
    }
  }

  async chainSummary(symbol: string, expiryDateIso?: string): Promise<ChainSummary | null> {
    try {
      const queryOpts = expiryDateIso ? { date: new Date(expiryDateIso) } : {};
      const opts = await yahooFinance.options(symbol, queryOpts);
      const spot = (opts as any).quote?.regularMarketPrice ?? null;
      if (!opts.options || opts.options.length === 0) return null;
      const chain = opts.options[0];
      const expiry =
        chain.expirationDate instanceof Date
          ? chain.expirationDate.toISOString().slice(0, 10)
          : String(chain.expirationDate);
      const daysToExpiry = Math.max(0, Math.round((new Date(expiry).getTime() - Date.now()) / 86400000));

      const calls = (chain.calls ?? []) as any[];
      const puts = (chain.puts ?? []) as any[];

      const sumVol = (arr: any[]) => arr.reduce((s, c) => s + (typeof c.volume === "number" ? c.volume : 0), 0);
      const sumOi = (arr: any[]) => arr.reduce((s, c) => s + (typeof c.openInterest === "number" ? c.openInterest : 0), 0);
      const sumNotional = (arr: any[]) =>
        arr.reduce((s, c) => {
          const m = midPrice(c);
          const v = typeof c.volume === "number" ? c.volume : 0;
          if (m == null || v === 0) return s;
          return s + m * v * 100;
        }, 0);

      const callVolume = sumVol(calls);
      const putVolume = sumVol(puts);
      const callOpenInterest = sumOi(calls);
      const putOpenInterest = sumOi(puts);
      const callNotionalUsd = sumNotional(calls);
      const putNotionalUsd = sumNotional(puts);

      let atmIv: number | null = null;
      if (spot && calls.length && puts.length) {
        const closest = (rows: any[]) =>
          rows.reduce((best, c) =>
            Math.abs((c.strike ?? Infinity) - spot) < Math.abs((best.strike ?? Infinity) - spot) ? c : best,
          );
        const aCall = closest(calls);
        const aPut = closest(puts);
        const cIv = typeof aCall.impliedVolatility === "number" ? aCall.impliedVolatility : null;
        const pIv = typeof aPut.impliedVolatility === "number" ? aPut.impliedVolatility : null;
        atmIv = cIv != null && pIv != null ? (cIv + pIv) / 2 : cIv ?? pIv ?? null;
      }

      const toActivity = (rows: any[], type: "call" | "put"): ContractActivity[] =>
        rows
          .filter((c) => typeof c.volume === "number" && c.volume >= 50)
          .map((c) => {
            const vol = c.volume as number;
            const oi = typeof c.openInterest === "number" ? c.openInterest : 0;
            const m = midPrice(c);
            return {
              type,
              strike: c.strike as number,
              expiry,
              daysToExpiry,
              volume: vol,
              openInterest: oi,
              volOiRatio: vol / Math.max(oi, 1),
              mid: m,
              impliedVolatility: typeof c.impliedVolatility === "number" ? c.impliedVolatility : null,
              notionalUsd: m != null ? m * vol * 100 : null,
            };
          });

      const notableContracts = [...toActivity(calls, "call"), ...toActivity(puts, "put")]
        .sort((a, b) => b.volOiRatio - a.volOiRatio)
        .slice(0, 5);

      return {
        symbol,
        spot,
        expiry,
        daysToExpiry,
        callVolume,
        putVolume,
        callOpenInterest,
        putOpenInterest,
        callNotionalUsd,
        putNotionalUsd,
        callPutVolumeRatio: putVolume > 0 ? callVolume / putVolume : null,
        callPutOiRatio: putOpenInterest > 0 ? callOpenInterest / putOpenInterest : null,
        atmIv,
        notableContracts,
        asOf: new Date().toISOString(),
      };
    } catch (err) {
      console.error("YahooOptionsProvider.chainSummary error", symbol, err);
      return null;
    }
  }

  async impliedMove(symbol: string): Promise<ImpliedMove> {
    const fallback: ImpliedMove = {
      symbol,
      spot: null,
      expiry: null,
      atmStraddlePrice: null,
      impliedMovePct: null,
    };
    try {
      const opts = await yahooFinance.options(symbol);
      const spot =
        (opts as any).quote?.regularMarketPrice ??
        (opts as any).underlyingSymbol === symbol
          ? (opts as any).quote?.regularMarketPrice ?? null
          : null;
      if (!spot || !opts.options || opts.options.length === 0) return fallback;

      const chain = opts.options[0];
      const expiry = chain.expirationDate instanceof Date
        ? chain.expirationDate.toISOString().slice(0, 10)
        : String(chain.expirationDate);

      const calls = chain.calls ?? [];
      const puts = chain.puts ?? [];
      if (calls.length === 0 || puts.length === 0) return { ...fallback, spot };

      const atmCall = calls.reduce((best: any, c: any) =>
        Math.abs((c.strike ?? Infinity) - spot) < Math.abs((best.strike ?? Infinity) - spot) ? c : best,
      );
      const atmPut = puts.reduce((best: any, p: any) =>
        Math.abs((p.strike ?? Infinity) - spot) < Math.abs((best.strike ?? Infinity) - spot) ? p : best,
      );

      const callMid = midPrice(atmCall);
      const putMid = midPrice(atmPut);
      if (callMid == null || putMid == null) return { ...fallback, spot, expiry };

      const straddle = callMid + putMid;
      const movePct = (straddle / spot) * 100;
      return { symbol, spot, expiry, atmStraddlePrice: straddle, impliedMovePct: movePct };
    } catch (err) {
      console.error("YahooOptionsProvider.impliedMove error", symbol, err);
      return fallback;
    }
  }
}

function midPrice(opt: any): number | null {
  const bid = typeof opt?.bid === "number" ? opt.bid : null;
  const ask = typeof opt?.ask === "number" ? opt.ask : null;
  if (bid != null && ask != null && bid > 0 && ask > 0) return (bid + ask) / 2;
  if (typeof opt?.lastPrice === "number" && opt.lastPrice > 0) return opt.lastPrice;
  return null;
}

function toContractQuote(opt: any): ContractQuote | null {
  if (!opt || typeof opt.strike !== "number") return null;
  const bid = typeof opt.bid === "number" ? opt.bid : null;
  const ask = typeof opt.ask === "number" ? opt.ask : null;
  return {
    strike: opt.strike,
    bid,
    ask,
    mid: midPrice(opt),
    lastPrice: typeof opt.lastPrice === "number" ? opt.lastPrice : null,
    openInterest: typeof opt.openInterest === "number" ? opt.openInterest : null,
    impliedVolatility: typeof opt.impliedVolatility === "number" ? opt.impliedVolatility : null,
  };
}

let provider: OptionsProvider | undefined;
export function getOptionsProvider(): OptionsProvider {
  if (!provider) provider = new YahooOptionsProvider();
  return provider;
}
