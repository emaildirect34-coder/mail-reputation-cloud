export function wilson95(successes: number, attempts: number) {
  if (!Number.isFinite(successes) || !Number.isFinite(attempts) || attempts <= 0) return null;
  const n = Math.floor(attempts), p = Math.min(1, Math.max(0, successes / attempts)), z = 1.959963984540054;
  const denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)] as const;
}

function normalCdf(z: number) {
  const x = Math.abs(z) / Math.sqrt(2), t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + Math.sign(z) * erf);
}

export function proportionPValue(a: number, nA: number, b: number, nB: number) {
  if (nA <= 0 || nB <= 0 || a < 0 || b < 0 || a > nA || b > nB) return null;
  const pooled = (a + b) / (nA + nB);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  if (!standardError) return a / nA === b / nB ? 1 : 0;
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(a / nA - b / nB) / standardError)));
}
