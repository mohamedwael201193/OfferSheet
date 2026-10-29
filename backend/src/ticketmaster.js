// Ticketmaster Discovery API leg — the break-even ground truth (capacity + event
// history + ticket prices). Server-side only: the key travels in the query string
// because that is Ticketmaster's documented auth, and it never leaves the server.
// TO-VERIFY at deploy time (spec §4.1): (a) self-serve key issuance flow,
// (b) whether venue capacity is present in venue/event responses for the rooms
// tested, (c) ticket-price fields. Until a live call proves otherwise, capacity
// field presence is UNKNOWN — a missing capacity always yields the
// "unknown capacity" state, never an invented number.
export async function searchEvents({ keyword, city, key, baseUrl, fetchImpl = fetch, size = 5 }) {
  const url = new URL(`${baseUrl}/events.json`);
  url.searchParams.set('apikey', key);
  if (keyword) url.searchParams.set('keyword', keyword);
  if (city) url.searchParams.set('city', city);
  url.searchParams.set('size', String(size));
  url.searchParams.set('sort', 'date,asc');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetchImpl(url.toString(), { headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => null);
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function searchVenues({ keyword, key, baseUrl, fetchImpl = fetch, size = 5 }) {
  const url = new URL(`${baseUrl}/venues.json`);
  url.searchParams.set('apikey', key);
  if (keyword) url.searchParams.set('keyword', keyword);
  url.searchParams.set('size', String(size));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetchImpl(url.toString(), { headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => null);
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

// Capacity extraction — field presence is TO-VERIFY live. Any venue shape without
// a numeric capacity yields null, which the pipeline maps to "unknown capacity".
export function extractCapacity(venue) {
  if (!venue || typeof venue !== 'object') return null;
  const v = venue.capacity ?? venue.seatingCapacity ?? venue.generalInfo?.capacity ?? null;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

// Price extraction from Ticketmaster priceRanges. When a min/max range is present,
// the documented rule is the AVERAGE of min and max, labeled as such on the card.
// A single price is used as-is. No price data -> null (price-unknown state).
export function extractPrice(eventsBody) {
  const events = eventsBody?._embedded?.events;
  if (!Array.isArray(events)) return null;
  for (const ev of events) {
    const ranges = ev?.priceRanges;
    if (Array.isArray(ranges) && ranges.length > 0) {
      const r = ranges[0];
      if (typeof r.min === 'number' && typeof r.max === 'number') {
        return { price: (r.min + r.max) / 2, source: 'average of Ticketmaster price range', currency: r.currency || null };
      }
      if (typeof r.min === 'number') {
        return { price: r.min, source: 'Ticketmaster price range minimum', currency: r.currency || null };
      }
    }
  }
  return null;
}

export function extractFirstVenue(eventsBody) {
  const events = eventsBody?._embedded?.events;
  if (!Array.isArray(events)) return null;
  for (const ev of events) {
    const venues = ev?._embedded?.venues;
    if (Array.isArray(venues) && venues.length > 0) return venues[0];
  }
  return null;
}
