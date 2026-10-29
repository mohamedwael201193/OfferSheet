// Verdict pipeline — the single decision path from input to card.
// Dependency injection: production wires live transports; tests wire fixture
// transports. Production code never imports test fixtures.
// Input: { artist, city, guarantee, ticketPrice?, variableCost?, capacity?,
//   entityHint?, visitorIp? }
// Deps: { config, guards, receipts, checkCall, checkVisitor, mcpCall, restCall,
//   tmEvents, tmVenues, geocodeFn, wikidataFn, gutArm, webArm, now? }
//   mcpCall(tool, args) -> envelope (throws OfferError on envelope error)
//   restCall({path, params}) -> REST result object
//   tmEvents({keyword, city}) -> TM events result; tmVenues({keyword}) -> TM venues
//   geocodeFn({query}) / wikidataFn({query}) -> leg results
//   gutArm({question}) / webArm({question, webFacts}) -> arm results
// S1 verdict gating: the verdict (break-even number, audience number, picks)
// renders ONLY when every required Qloo leg succeeded:
//   resolve (find_tags or describe), rank-or-recommend, where_popular,
//   demographics, overlap (compare or entity_tags).
// Any required leg missing -> { status: 'verdict_withheld' } with NO numbers.
// Non-required legs (trends, REST legs, OSM, Wikidata, arms, Ticketmaster)
// failing only produce labeled omissions — they never block the verdict, and
// they never fabricate a value.
// Audience honesty: Qloo returns no headcount. The card reports matched
// areas/entities and counts WITH receipts — never a population number.
// Capacity honesty: capacity is null unless Ticketmaster reported one or the
// user supplied one (labeled). A null capacity means NO sellout percentage,
// NO "will sell out" claim, NO room-fill claim — anywhere in the response.
import { notConfigured, invalidInput } from './errors.js';
import { breakEven } from './breakeven.js';
import { argsHashFor } from './receipts.js';
import { extractCapacity, extractPrice, extractFirstVenue } from './ticketmaster.js';

function itemId(item) {
  if (!item || typeof item !== 'object') return null;
  return item.entity_id ?? item.id ?? item.uuid ?? null;
}

function itemName(item) {
  if (!item || typeof item !== 'object') return null;
  return item.name ?? item.properties?.name ?? null;
}

function firstResult(envelope) {
  const results = Array.isArray(envelope?.results) ? envelope.results : [];
  return results[0] ?? null;
}

function resultNames(envelope, limit = 10) {
  const results = Array.isArray(envelope?.results) ? envelope.results : [];
  return results.slice(0, limit).map((r) => ({ id: itemId(r), name: itemName(r) })).filter((r) => r.id || r.name);
}

function tagUrns(envelope, limit = 10) {
  const results = Array.isArray(envelope?.results) ? envelope.results : [];
  const urns = [];
  for (const r of results) {
    const u = r?.urn ?? r?.tag_urn ?? (typeof r?.tag === 'string' ? r.tag : null);
    if (typeof u === 'string' && u.startsWith('urn:')) urns.push(u);
    if (urns.length >= limit) break;
  }
  return urns;
}

export async function runVerdict(input, deps) {
  const started = Date.now();
  const { config, guards, receipts } = deps;
  const artist = typeof input.artist === 'string' ? input.artist.trim() : '';
  const city = typeof input.city === 'string' ? input.city.trim() : '';
  const guarantee = input.guarantee;
  if (!artist) throw invalidInput('artist is required');
  if (!city) throw invalidInput('city is required');
  if (typeof guarantee !== 'number' || !Number.isFinite(guarantee) || guarantee < 0) {
    throw invalidInput('guarantee must be a non-negative number');
  }
  const variableCost = typeof input.variableCost === 'number' ? input.variableCost : 0;
  if (variableCost < 0) throw invalidInput('variableCost must be non-negative');

  // Fail-closed gate: no Qloo key, no verdict path at all.
  if (!config.qlooKeyConfigured) throw notConfigured('Qloo API key is not configured');

  // Per-visitor and per-run guards (design settings, not Qloo quotas).
  if (input.visitorIp && deps.checkVisitor) deps.checkVisitor(input.visitorIp);
  if (guards && typeof guards.resetRun === 'function') guards.resetRun();
  const checkCall = deps.checkCall || (() => {});
  const call = async (tool, args) => {
    checkCall();
    const env = await deps.mcpCall(tool, args);
    if (env && typeof env === 'object') env._requestHash = argsHashFor(tool, args);
    if (env && typeof env === 'object') env._replay = { kind: 'mcp', tool, args };
    return env;
  };
  const rest = async (path, params) => {
    checkCall();
    const out = await deps.restCall({ path, params });
    if (out && typeof out === 'object') out._replay = { kind: 'rest', path, params };
    return out;
  };

  const legs = {};
  const record = (claim, operation, src, overrides = {}) => receipts.add({
    claim,
    operation,
    requestHash: src?.requestHash ?? src?._requestHash ?? null,
    requestId: src?.requestId ?? null,
    resultCount: overrides.resultCount ?? src?.resultCount ?? src?.result_count ?? (Array.isArray(src?.results) ? src.results.length : null),
    replay: src?._replay ?? null,
  });

  // Gate: readiness probe (reports readiness without calling Qloo data).
  let readiness = null;
  try {
    readiness = await call('qloo_capabilities', {});
    record('Qloo readiness probe', 'qloo_capabilities', readiness, { resultCount: Array.isArray(readiness?.operations) ? readiness.operations.length : null });
  } catch (e) {
    throw e; // fail closed: an unhealthy transport blocks the verdict
  }

  // Resolve: tag-first path + headliner description.
  let tags = null;
  let describe = null;
  try {
    tags = await call('qloo_find_tags', { query: artist, limit: 10 });
    legs.findTags = { status: 'ok', results: resultNames(tags) };
    record('headliner tags', 'qloo_find_tags', tags);
  } catch (e) {
    legs.findTags = { status: 'error', reason: e.message };
  }
  try {
    describe = await call('qloo_describe', { entity: input.entityHint || artist, type: 'artist' });
    const first = firstResult(describe);
    if (describe?.status === 'needs_input') {
      return {
        status: 'needs_input',
        message: 'The headliner name matched multiple entities. Pick the one you mean — the verdict never guesses.',
        candidates: resultNames(describe),
        receipts: receipts.all(),
        timingMs: Date.now() - started,
      };
    }
    legs.describe = { status: 'ok', headliner: first ? { id: itemId(first), name: itemName(first) } : null };
    record('headliner description', 'qloo_describe', describe);
  } catch (e) {
    legs.describe = { status: 'error', reason: e.message };
  }
  const headliner = legs.describe?.headliner;
  const headlinerSignal = headliner?.id || headliner?.name || artist;

  // Recommend + rank: opener candidates for the headliner.
  let recommend = null;
  let rank = null;
  try {
    recommend = await call('qloo_recommend', { target_type: 'artist', signals: [headlinerSignal], limit: 10 });
    legs.recommend = { status: 'ok', candidates: resultNames(recommend) };
    record('opener candidates from headliner fans', 'qloo_recommend', recommend);
  } catch (e) {
    legs.recommend = { status: 'error', reason: e.message };
  }
  const rankOptions = (legs.recommend?.candidates || []).map((c) => c.id || c.name).filter(Boolean);
  if (rankOptions.length > 0) {
    try {
      rank = await call('qloo_rank', { options: rankOptions, option_type: 'artist', signals: [headlinerSignal], signal_location: city });
      legs.rank = { status: 'ok', ranked: resultNames(rank) };
      record('opener shortlist ranked for the city audience', 'qloo_rank', rank);
    } catch (e) {
      legs.rank = { status: 'error', reason: e.message };
    }
  } else {
    legs.rank = { status: 'skipped', reason: 'no opener candidates to rank' };
  }
  const topOpener = legs.rank?.ranked?.[0] || legs.recommend?.candidates?.[0] || null;
  const topOpenerSignal = topOpener ? topOpener.id || topOpener.name : null;

  // Evidence legs: where_popular (routing + city audience), demographics,
  // overlap (compare or entity_tags), shared tags, trends (optional).
  try {
    const wp = await call('qloo_where_popular', { entity: headlinerSignal, within: city, limit: 10 });
    legs.wherePopular = { status: 'ok', areas: resultNames(wp) };
    record('where the headliner is popular (city audience areas)', 'qloo_where_popular', wp);
  } catch (e) {
    legs.wherePopular = { status: 'error', reason: e.message };
  }
  try {
    const demo = await call('qloo_audience_demographics', { entity: headlinerSignal, entity_type: 'artist' });
    legs.demographics = { status: 'ok', bands: Array.isArray(demo?.results) ? demo.results.slice(0, 20) : [] };
    record('audience demographic bands', 'qloo_audience_demographics', demo);
  } catch (e) {
    legs.demographics = { status: 'error', reason: e.message };
  }
  if (topOpenerSignal) {
    try {
      const cmp = await call('qloo_compare_audiences', { group_a: [headlinerSignal], group_b: [topOpenerSignal], target_type: 'artist' });
      legs.compare = { status: 'ok', result: Array.isArray(cmp?.results) ? cmp.results.slice(0, 20) : [] };
      record('headliner-vs-opener audience overlap', 'qloo_compare_audiences', cmp);
    } catch (e) {
      legs.compare = { status: 'error', reason: e.message };
    }
  } else {
    legs.compare = { status: 'skipped', reason: 'no opener to compare against' };
  }
  try {
    const entities = [headlinerSignal, ...(topOpenerSignal ? [topOpenerSignal] : [])];
    const et = await call('qloo_entity_tags', { entities, entity_type: 'artist', limit: 10 });
    legs.entityTags = { status: 'ok', tags: Array.isArray(et?.results) ? et.results.slice(0, 20) : [] };
    record('top shared tags evidence', 'qloo_entity_tags', et);
  } catch (e) {
    legs.entityTags = { status: 'error', reason: e.message };
  }
  const today = new Date();
  const start90 = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  const iso = (d) => d.toISOString().slice(0, 10);
  try {
    const tr = await call('qloo_trends', { entities: [headlinerSignal], entity_type: 'artist', start_date: iso(start90), end_date: iso(today) });
    legs.trends = { status: 'ok', points: Array.isArray(tr?.results) ? tr.results.slice(0, 20) : [] };
    record('headliner momentum (90-day trend)', 'qloo_trends', tr);
  } catch (e) {
    legs.trends = { status: 'error', reason: e.message };
  }

  // REST cross-check legs (non-required evidence; failures are labeled).
  try {
    const sr = await rest('/search', { query: artist, take: 5 });
    legs.restSearch = { status: sr.ok ? 'ok' : 'error', entities: sr.entities || [], httpStatus: sr.status };
    if (sr.ok) record('REST name resolution', 'rest:/search', sr);
  } catch (e) {
    legs.restSearch = { status: 'error', reason: e.message };
  }
  const urns = tags ? tagUrns(tags) : [];
  if (urns.length > 0) {
    try {
      const ins = await rest('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.tags': urns.join(','), 'feature.explainability': 'true' });
      legs.restInsights = { status: ins.ok ? 'ok' : 'error', httpStatus: ins.status, resultCount: ins.resultCount };
      if (ins.ok) record('REST insights by tags with explainability', 'rest:/v2/insights', ins);
    } catch (e) {
      legs.restInsights = { status: 'error', reason: e.message };
    }
  } else {
    legs.restInsights = { status: 'skipped', reason: 'no tag URNs resolved' };
  }

  // S1 GATE: required legs must all be ok. Anything else -> WITHHELD, no numbers.
  const requiredOk =
    (legs.findTags?.status === 'ok' || legs.describe?.status === 'ok') &&
    (legs.rank?.status === 'ok' || legs.recommend?.status === 'ok') &&
    legs.wherePopular?.status === 'ok' &&
    legs.demographics?.status === 'ok' &&
    (legs.compare?.status === 'ok' || legs.entityTags?.status === 'ok');
  if (!requiredOk) {
    const missing = [];
    if (!(legs.findTags?.status === 'ok' || legs.describe?.status === 'ok')) missing.push('resolve (find_tags/describe)');
    if (!(legs.rank?.status === 'ok' || legs.recommend?.status === 'ok')) missing.push('rank-or-recommend');
    if (legs.wherePopular?.status !== 'ok') missing.push('where_popular');
    if (legs.demographics?.status !== 'ok') missing.push('demographics');
    if (!(legs.compare?.status === 'ok' || legs.entityTags?.status === 'ok')) missing.push('compare-or-entity_tags');
    return {
      status: 'verdict_withheld',
      message: 'VERDICT WITHHELD — Qloo evidence is incomplete. No verdict numbers are shown from partial evidence.',
      missingLegs: missing,
      legs,
      receipts: receipts.all(),
      timingMs: Date.now() - started,
    };
  }

  // Ticketmaster leg: capacity + event history + prices (key-gated, non-blocking).
  let tmState = { status: 'not_configured', note: 'Ticketmaster key not configured — capacity leg unavailable' };
  let tmCapacity = null;
  let tmPrice = null;
  let tmEventsCount = null;
  if (config.tmKeyConfigured && deps.tmEvents) {
    try {
      const ev = await deps.tmEvents({ keyword: artist, city });
      if (ev.ok) {
        tmEventsCount = Array.isArray(ev.body?._embedded?.events) ? ev.body._embedded.events.length : 0;
        const venue = extractFirstVenue(ev.body);
        tmCapacity = extractCapacity(venue);
        tmPrice = extractPrice(ev.body);
        tmState = { status: 'ok', eventsFound: tmEventsCount, venueName: venue?.name ?? null, capacityReported: tmCapacity !== null };
      } else {
        tmState = { status: 'error', reason: `Ticketmaster returned ${ev.status}` };
      }
    } catch (e) {
      tmState = { status: 'error', reason: e.message };
    }
  }

  // OSM + Wikidata legs: best-effort, never blocking.
  let osmState = { status: 'skipped', note: 'geocoding leg not wired' };
  if (deps.geocodeFn) {
    try {
      const g = await deps.geocodeFn({ query: city });
      osmState = g.ok && g.result
        ? { status: 'ok', displayName: g.result.displayName, lat: g.result.lat, lon: g.result.lon }
        : { status: 'unavailable', note: 'city used as typed; location filters omitted' };
    } catch (e) {
      osmState = { status: 'error', reason: e.message };
    }
  }
  let wikidataState = { status: 'skipped', note: 'fact cross-check leg not wired' };
  let webFacts = [];
  if (deps.wikidataFn) {
    try {
      const w = await deps.wikidataFn({ query: artist });
      wikidataState = w.ok
        ? { status: 'ok', matches: w.results }
        : { status: 'error', reason: `Wikidata returned ${w.status}` };
      webFacts = (w.results || []).map((r) => `${r.label}${r.description ? ` — ${r.description}` : ''} (${r.id})`);
    } catch (e) {
      wikidataState = { status: 'error', reason: e.message };
    }
  }

  // Price resolution: user price first (labeled), then Ticketmaster (labeled).
  let price = null;
  let priceSource = null;
  if (typeof input.ticketPrice === 'number' && Number.isFinite(input.ticketPrice) && input.ticketPrice > 0) {
    price = input.ticketPrice;
    priceSource = 'user-supplied';
  } else if (tmPrice) {
    price = tmPrice.price;
    priceSource = tmPrice.source;
  }
  if (!price) {
    return {
      status: 'price_unknown',
      message: 'No ticket price available — neither the promoter nor Ticketmaster supplied one. Break-even cannot be computed without inventing a number.',
      legs,
      ticketmaster: tmState,
      osm: osmState,
      wikidata: wikidataState,
      receipts: receipts.all(),
      timingMs: Date.now() - started,
    };
  }

  // Capacity resolution: user capacity (labeled) beats Ticketmaster-reported.
  let capacity = null;
  let capacitySource = null;
  if (typeof input.capacity === 'number' && Number.isFinite(input.capacity) && input.capacity > 0) {
    capacity = input.capacity;
    capacitySource = 'user-supplied, not Ticketmaster-verified';
  } else if (tmCapacity !== null) {
    capacity = tmCapacity;
    capacitySource = 'Ticketmaster-reported';
  }

  const be = breakEven({ guarantee, ticketPrice: price, variableCost, capacity });
  const graphPick = topOpener?.name || null;

  // Arms: Gut + Web (unavailable when no LLM is configured — never fabricated).
  const question = `Headliner ${artist} in ${city}. Who is the best opening act for this audience?`;
  let gut = { arm: 'gut', status: 'unavailable', reason: 'arm not wired' };
  let web = { arm: 'web', status: 'unavailable', reason: 'arm not wired' };
  if (deps.gutArm) gut = await deps.gutArm({ question }).catch((e) => ({ arm: 'gut', status: 'error', reason: e.message }));
  if (deps.webArm) web = await deps.webArm({ question, webFacts }).catch((e) => ({ arm: 'web', status: 'error', reason: e.message }));
  const gutPick = gut.status === 'ok' ? gut.pick : null;
  const webPick = web.status === 'ok' ? web.pick : null;
  const missTrial = (gutPick || webPick) && graphPick
    ? {
        question,
        graphPick,
        gutPick,
        webPick,
        misses: [
          ...(gutPick && gutPick !== graphPick ? [{ arm: 'gut', pick: gutPick, graphPick }] : []),
          ...(webPick && webPick !== graphPick ? [{ arm: 'web', pick: webPick, graphPick }] : []),
        ],
        recordedAt: new Date().toISOString(),
      }
    : null;

  return {
    status: 'verdict',
    artist,
    city,
    guarantee,
    breakEven: {
      tickets: be.tickets,
      net: be.net,
      note: be.note,
      verdict: be.verdict,
      price: { value: price, source: priceSource },
    },
    capacity: capacity === null
      ? {
          value: null,
          source: null,
          state: 'unknown',
          message: 'Venue capacity unknown — Ticketmaster returned no capacity for this room. Break-even is shown as tickets needed, not as a sellout percentage. Verify room size before signing.',
        }
      : { value: capacity, source: capacitySource, state: 'known' },
    audience: {
      areas: legs.wherePopular.areas,
      areasCount: legs.wherePopular.areas.length,
      note: 'Qloo returns matched areas/entities, not a headcount — no population number is claimed.',
    },
    openers: {
      ranked: legs.rank?.ranked || [],
      candidates: legs.recommend?.candidates || [],
      topPick: graphPick,
    },
    demographics: legs.demographics.bands,
    trends: legs.trends?.points || null,
    sharedTags: legs.entityTags?.tags || null,
    overlap: legs.compare?.result || null,
    arms: { gut, web, graph: { arm: 'graph', status: 'ok', pick: graphPick } },
    missTrial,
    ticketmaster: tmState,
    osm: osmState,
    wikidata: wikidataState,
    legs,
    receipts: receipts.all(),
    timingMs: Date.now() - started,
  };
}
