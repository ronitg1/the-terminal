export function logReturns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (prev > 0 && cur > 0) r.push(Math.log(cur / prev));
  }
  return r;
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let num = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return 0;
  return num / Math.sqrt(varA * varB);
}

export function correlationMatrix(seriesBySymbol: Record<string, number[]>): {
  symbols: string[];
  matrix: number[][];
} {
  const symbols = Object.keys(seriesBySymbol).sort();
  const returns = symbols.map((s) => logReturns(seriesBySymbol[s]));
  const matrix: number[][] = symbols.map(() => symbols.map(() => 0));
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i; j < symbols.length; j++) {
      const c = i === j ? 1 : pearson(returns[i], returns[j]);
      matrix[i][j] = c;
      matrix[j][i] = c;
    }
  }
  return { symbols, matrix };
}
