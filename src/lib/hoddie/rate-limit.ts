/** Best-effort per-user limiter. Serverless instances do not share memory, so this only blunts bursts. */
const hits = new Map<string, number[]>();
export function allowRequest(key: string, now = Date.now(), limit = 20, windowMs = 60_000) {
  const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) { hits.set(key, recent); return false; }
  recent.push(now); hits.set(key, recent);
  if (hits.size > 5_000) for (const [id, times] of hits) if (times.every((time) => now - time >= windowMs)) hits.delete(id);
  return true;
}
export const resetRateLimit = () => hits.clear();
