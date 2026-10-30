// Ticketmaster Discovery API leg — the break-even ground truth (capacity + event
// history + ticket prices). Server-side only: the key travels in the query string
// because that is Ticketmaster's documented auth, and it never leaves the server.
// TO-VERIFY at deploy time (spec §4.1): (a) self-serve key issuance flow,
// (b) whether venue capacity is present in venue/event responses for the rooms
// tested, (c) ticket-price fields. Until a live call proves otherwise, capacity
// field presence is UNKNOWN — a missing capacity always yields the
// "unknown capacity" state, never an invented number.
export async function searchEvents({ keyword, city, venueId, key, baseUrl, fetchImpl = fetch, size = 5, timeoutMs = 25000 }) {
  const url = new URL(`${baseUrl}/events.json`);
  url.searchParams.set('apikey', key);
  if (keyword) url.searchParams.set('keyword', keyword);
  if (city) url.searchParams.set('city', city);
  // G11: when a venue resolved via venue search, scope the event lookup to
  // that venue (Ticketmaster's documented venueId filter) so capacity and
  // price describe the offer room, not whatever event matches first.
  if (venueId) url.searchParams.set('venueId', venueId);
  url.searchParams.set('size', String(size));
  url.searchParams.set('sort', 'date,asc');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url.toString(), { headers: { Accept: 'application/json' }, signal: controller.signal });
    const body = await res.json().catch(() => null);
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function searchVenues({ keyword, key, baseUrl, fetchImpl = fetch, size = 5, timeoutMs = 25000 }) {
  const url = new URL(`${baseUrl}/venues.json`);
  url.searchParams.set('apikey', key);
  if (keyword) url.searchParams.set('keyword', keyword);
  url.searchParams.set('size', String(size));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url.toString(), { headers: { Accept: 'application/json' }, signal: controller.signal });
    const body = await res.json().catch(() => null);
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

// Get Event Details (documented): re-fetch the single event whose price
// grounds break-even, so a canceled/postponed event's stale price range
// never grounds the verdict. A failed details call never upgrades the
// search-payload price — the caller falls back to the next priced event
// or to price-unknown. seatmap.staticUrl, when present, is a link only
// and must never be treated as a seat count.
export async function searchEventDetails({ id, key, baseUrl, fetchImpl = fetch }) {
  const url = new URL(`${baseUrl}/events/${encodeURIComponent(id)}.json`);
  url.searchParams.set('apikey', key);
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

// Get Venue Details (documented): confirm the resolved venue's identity
// (display-only context: aliases, box-office, parking, accessible
// seating). A failed details call keeps the search record and labels
// details unavailable — it never blocks the verdict.
export async function searchVenueDetails({ id, key, baseUrl, fetchImpl = fetch }) {
  const url = new URL(`${baseUrl}/venues/${encodeURIComponent(id)}.json`);
  url.searchParams.set('apikey', key);
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

// Event status code from a search-payload or details event record.
// UNWIRED: these detail helpers are exported but not yet called by the
// pipeline — wiring needs event-ID plumbing + live-shape confirmation.
export function eventStatusCode(ev) {
  return ev?.dates?.status?.code ?? null;
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
    // A canceled or postponed event's stale price range never grounds
    // break-even: skip it and move to the next priced event. Both
    // spellings are matched (canceled/cancelled); rescheduled events
    // are KEPT — a rescheduled event's price may still be live.
    if (eventStatusCode(ev) === 'canceled' || eventStatusCode(ev) === 'cancelled' || eventStatusCode(ev) === 'postponed') continue;
    const ranges = ev?.priceRanges;
    if (Array.isArray(ranges) && ranges.length > 0) {
      const r = ranges[0];
      // J3 minor (negative price): a non-finite or negative range bound is
      // treated as absent, never as a price — a negative price reaching the
      // pipeline would make breakEven throw a plain Error (HTTP 500). Skip
      // to the next event instead of returning a corrupting price.
      const minOk = typeof r.min === 'number' && Number.isFinite(r.min) && r.min >= 0;
      const maxOk = typeof r.max === 'number' && Number.isFinite(r.max) && r.max >= 0;
      if (minOk && maxOk) {
        return { price: (r.min + r.max) / 2, source: 'average of Ticketmaster price range', currency: r.currency || null };
      }
      if (minOk) {
        return { price: r.min, source: 'Ticketmaster price range minimum', currency: r.currency || null };
      }
    }
  }
  return null;
}

// City of a venue record, across the shapes the API returns (city as an
// object with a name, or as a plain string). Null when the record carries
// no city — never a guessed city.
export function venueCityOf(venue) {
  if (!venue || typeof venue !== 'object') return null;
  const c = venue.city ?? venue.address?.city ?? null;
  if (typeof c === 'string' && c.trim() !== '') return c.trim();
  if (c && typeof c === 'object' && typeof c.name === 'string' && c.name.trim() !== '') return c.name.trim();
  return null;
}

// J3 M7: named-room venue search previously took the first result with no
// city filter, so a same-named venue in another city could ground the
// verdict. Prefer a returned venue whose city matches the offer city
// (case-insensitive); fall back to the first result exactly as before when
// no returned venue matches, so an unmatched city shape can never regress
// a resolved room to unresolved. The server-side city query parameter was
// NOT added: its filtering behaviour is unverified live, while this
// client-side preference is fully unit-testable and cannot regress.
export function extractVenueForCity(venuesBody, city) {
  const venues = venuesBody?._embedded?.venues;
  if (!Array.isArray(venues) || venues.length === 0) return null;
  const want = typeof city === 'string' ? city.trim().toLowerCase() : '';
  if (want !== '') {
    for (const v of venues) {
      const vc = venueCityOf(v);
      if (vc && vc.toLowerCase() === want) return v;
    }
  }
  return venues[0] ?? null;
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

// G11: first venue from a venue-search response body (venues.json shape:
// _embedded.venues), or null when the search resolved nothing. A null here
// means "named room did not resolve" — never a guessed venue.
export function extractFirstVenueResult(venuesBody) {
  const venues = venuesBody?._embedded?.venues;
  if (!Array.isArray(venues)) return null;
  return venues[0] ?? null;
}
