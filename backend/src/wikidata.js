// Wikidata leg — public-facts cross-check (keyless). Name -> entity search only;
// no claim is ever derived from Wikidata alone, and a lookup failure never blocks
// the verdict — the leg is omitted with a labeled note.
export async function searchEntities({ query, baseUrl, fetchImpl = fetch, limit = 5 }) {
  const url = new URL(baseUrl);
  url.searchParams.set('action', 'wbsearchentities');
  url.searchParams.set('search', query);
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetchImpl(url.toString(), {
      headers: { 'User-Agent': 'OfferSheet/0.1 (Qloo Agentic Hackathon demo)', Accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, status: res.status, results: [] };
    const body = await res.json().catch(() => null);
    const results = Array.isArray(body?.search) ? body.search : [];
    return {
      ok: true,
      status: 200,
      results: results.map((r) => ({ id: r.id ?? null, label: r.label ?? null, description: r.description ?? null })),
    };
  } finally {
    clearTimeout(timer);
  }
}
