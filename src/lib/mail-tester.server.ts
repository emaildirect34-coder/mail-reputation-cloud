export async function mailTesterRequest(path: string, init?: RequestInit) {
  const url = process.env['MAILTESTER_URL'], key = process.env['MAILTESTER_KEY'];
  if (!url || !key) return { configured: false as const };
  const r = await fetch(url.replace(/\/$/, '') + path, { ...init, signal: init?.signal ?? AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });
  const text = await r.text();
  if (!r.ok) throw new Error(`Mail-Tester ${r.status}: ${text.slice(0, 200)}`);
  return { configured: true as const, body: JSON.parse(text) };
}
