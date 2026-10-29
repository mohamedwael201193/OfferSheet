// OpenStreetMap Nominatim leg — geocoding + city confirmation (keyless).
// Usage-policy rule honored: at most 1 request/second — calls are serialized with
// a >=1100ms gap. A geocode failure never blocks the verdict: the city is used as
// typed, location filters are omitted, and the omission is disclosed on the card.
// Never a guessed coordinate.
let lastCallAt = 0;

export async function geocode({ query, baseUrl, fetchImpl = fetch }) {
  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - lastCallAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '1');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetchImpl(url.toString(), {
      headers: {
        'User-Agent': 'OfferSheet/0.1 (Qloo Agentic Hackathon demo)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return { ok: false, status: res.status, result: null };
    const body = await res.json().catch(() => null);
    const first = Array.isArray(body) ? body[0] : null;
    if (!first) return { ok: true, status: 200, result: null };
    return {
      ok: true,
      status: 200,
      result: {
        displayName: first.display_name ?? null,
        lat: first.lat ?? null,
        lon: first.lon ?? null,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
