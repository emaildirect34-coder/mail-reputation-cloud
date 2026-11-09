// Spintax {a|b|{c|d}} and variable fallbacks {first_name|Cher client}, shared by sending and preview.
export const VAR_NAMES = ['first_name', 'to', 'from_name', 'from_email'];

// Deterministic PRNG so one recipient always gets the same variation (retries stay consistent).
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

export function fillFallbacks(s: string, vars: Record<string, string>) {
  return s.replace(new RegExp(`\\{(${VAR_NAMES.join('|')})\\|([^{}|]*)\\}`, 'g'), (_, k: string, fb: string) => vars[k] || fb);
}

const INNER = /\{([^{}]*\|[^{}]*)\}/;

export function spin(s: string, seed: string) {
  const r = rng(seed);
  let out = s, guard = 0;
  while (INNER.test(out) && guard++ < 10000) out = out.replace(INNER, (_, body: string) => { const o = body.split('|'); return o[Math.floor(r() * o.length)]; });
  return out;
}

export function expand(s: string, vars: Record<string, string>, seed: string) {
  return spin(fillFallbacks(s, vars), seed);
}

// Number of distinct outputs (capped), counting nested groups.
export function countVariants(s: string) {
  const vals: number[] = [];
  let out = fillFallbacks(s, {}), guard = 0;
  while (INNER.test(out) && guard++ < 10000) out = out.replace(INNER, (_, body: string) => {
    const parts = body.split('|');
    const n = parts.reduce((a, p) => a + [...p.matchAll(/\u0000(\d+)\u0000/g)].reduce((m, x) => m * vals[+x[1]], 1), 0);
    vals.push(n); return `\u0000${vals.length - 1}\u0000`;
  });
  return Math.min([...out.matchAll(/\u0000(\d+)\u0000/g)].reduce((m, x) => m * vals[+x[1]], 1), 1e12);
}
