// Verdict pipeline — the single decision path from input to card.
// Dependency injection: production wires live transports; tests wire fixture
// transports. Production code never imports test fixtures.
// Input: { artist, city, guarantee, ticketPrice?, variableCost?, capacity?,
//   venue?, entityHint?, visitorIp? }
//   venue: optional promoter-typed room name (G11). variableCost: optional
//   per-ticket cost — ABSENT (blank) is distinct from 0 (G12); the pipeline
//   records variableCostProvided so the UI never renders blank as zero cost.
// Deps: { config, guards, receipts, checkCall, checkVisitor, mcpCall, restCall,
//   tmEvents, tmVenues, geocodeFn, wikidataFn, gutArm, webArm, now? }
//   mcpCall(tool, args) -> envelope (throws OfferError on envelope error)
//   restCall({path, params}) -> REST result object
//   tmEvents({keyword, city, venueId?}) -> TM events result;
//   tmVenues({keyword}) -> TM venues result (venue search, G11)
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
import { notConfigured, invalidInput, isGuardTrip } from './errors.js';
import { breakEven } from './breakeven.js';
import { argsHashFor } from './receipts.js';
import { extractCapacity, extractPrice, extractFirstVenue, extractFirstVenueResult } from './ticketmaster.js';
import { classifyMisses } from './rerank.js';

function itemId(item) {
  if (!item || typeof item !== 'object') return null;
  return item.entity_id ?? item.id ?? item.uuid ?? null;
}

function itemName(item) {
  if (!item || typeof item !== 'object') return null;
  return item.name ?? item.properties?.name ?? null;
}

function namesOf(results, limit = 10) {
  const list = Array.isArray(results) ? results : [];
  return list.slice(0, limit).map((r) => ({ id: itemId(r), name: itemName(r) })).filter((r) => r.id || r.name);
}

function resultNames(envelope, limit = 10) {
  return namesOf(envelope?.results, limit);
}

// G5/G16 honest-status label: an empty result is never 'ok', never a zero,
// never a guess — it is labeled as no data for this entity/region.
export const EMPTY_LABEL = 'no data for this entity/region';

// G5: an MCP leg counts toward the verdict ONLY when its envelope status is
// 'ok' AND its results are non-empty. A partial/degraded envelope keeps its
// own status (its data may still be shown labeled, but it never counts as
// complete), and an ok-but-empty envelope becomes 'empty'.
// Gap 3 (diagnosability): every non-ok leg also carries `envelopeSummary` —
// Qloo's own summary text when present, else null — so an empty trends or
// compare leg can be diagnosed from the payload instead of from a generic
// label. The summary is Qloo's text, never client data, so it is safe to
// render; the landing agent owns rendering, not this file.
function mcpLeg(env, build) {
  if (!env || typeof env !== 'object') return { status: 'error', reason: 'no envelope returned', envelopeSummary: null };
  const results = Array.isArray(env.results) ? env.results : [];
  const summary = typeof env.summary === 'string' ? env.summary : null;
  if (env.status === 'ok' && results.length > 0) return { status: 'ok', ...build(results) };
  if (env.status === 'ok') return { status: 'empty', reason: summary || EMPTY_LABEL, envelopeSummary: summary, ...build([]) };
  if (env.status === 'partial' || env.status === 'degraded') {
    return { status: env.status, reason: summary || `Qloo returned status ${env.status}`, envelopeSummary: summary, ...build(results) };
  }
  if (env.status === 'empty') return { status: 'empty', reason: summary || EMPTY_LABEL, envelopeSummary: summary, ...build([]) };
  return { status: 'error', reason: summary || `Qloo returned status ${env.status || 'unknown'}`, envelopeSummary: summary };
}

// G16: a REST 2xx with an empty entities array and no result count records
// status 'empty' with the no-data label, never 'ok'. Gap 2: a 2xx object
// payload with no list (e.g. /v2/analysis/compare) still counts as 'ok'
// when the transport flags payloadPresent — the call returned a real body,
// so it earns a receipt; only a truly empty body stays 'empty'.
function restLeg(out, build) {
  if (!out || typeof out !== 'object') return { status: 'error', reason: 'no REST result returned' };
  if (!out.ok) return { status: 'error', reason: `Qloo REST returned ${out.status}`, httpStatus: out.status };
  const entities = Array.isArray(out.entities) ? out.entities : [];
  const count = out.resultCount ?? entities.length;
  if (entities.length === 0 && (count === null || count === 0) && !out.payloadPresent) {
    return { status: 'empty', reason: EMPTY_LABEL, httpStatus: out.status, resultCount: count, entities: [] };
  }
  return { status: 'ok', httpStatus: out.status, resultCount: count, ...build(out) };
}

function tagUrns(envelope, limit = 10) {
  const results = Array.isArray(envelope?.results) ? envelope.results : [];
  const urns = [];
  for (const r of results) {
    // Gap 2: the live find_tags envelope carries the tag URN in the `id`
    // field (e.g. {"id": "urn:tag:celebrity_spokesperson:qloo:billie_eilish"}),
    // which the old key list never matched — so the insights leg always
    // skipped. Accept an `id` that is itself a URN, after the older keys.
    const u = r?.urn ?? r?.tag_urn ?? (typeof r?.tag === 'string' ? r.tag : null)
      ?? (typeof r?.id === 'string' && r.id.startsWith('urn:') ? r.id : null);
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
  // G12: blank is NOT zero. Arithmetic still needs a number (0 when blank),
  // but variableCostProvided travels with the verdict so the UI renders a
  // blank cost as "before variable costs", never as "− 0".
  const variableCostProvided = typeof input.variableCost === 'number' && Number.isFinite(input.variableCost);
  const variableCost = variableCostProvided ? input.variableCost : 0;
  if (variableCost < 0) throw invalidInput('variableCost must be non-negative');
  const venueQuery = typeof input.venue === 'string' ? input.venue.trim() : '';

  // Fail-closed gate: no Qloo key, no verdict path at all.
  if (!config.qlooKeyConfigured) throw notConfigured('Qloo API key is not configured');

  // Per-visitor and per-run guards (design settings, not Qloo quotas).
  if (input.visitorIp && deps.checkVisitor) deps.checkVisitor(input.visitorIp);
  if (guards && typeof guards.resetRun === 'function') guards.resetRun();
  const checkCall = deps.checkCall || (() => {});
  // Guard trips inside a leg's try/catch must not degrade into a generic leg
  // error: the trip is recorded here and rethrown before the verdict gate,
  // so a mid-run QUOTA_FLOOR / RUN_CAP surfaces as its 503, never as a
  // 200 verdict_withheld. Trips happen before any live call for that leg,
  // so no live call is made after a trip.
  let guardError = null;
  const call = async (tool, args) => {
    try {
      checkCall();
      const env = await deps.mcpCall(tool, args);
      if (env && typeof env === 'object') env._requestHash = argsHashFor(tool, args);
      if (env && typeof env === 'object') env._replay = { kind: 'mcp', tool, args };
      return env;
    } catch (e) {
      if (isGuardTrip(e)) guardError = e;
      throw e;
    }
  };
  const rest = async (path, params) => {
    try {
      checkCall();
      const out = await deps.restCall({ path, params });
      if (out && typeof out === 'object') out._replay = { kind: 'rest', path, params };
      return out;
    } catch (e) {
      if (isGuardTrip(e)) guardError = e;
      throw e;
    }
  };

  const legs = {};
  const record = (claim, operation, src, overrides = {}) => {
    // G7-alignment: receipts carry the original run's ORDERED entity-ID list
    // (both `ids` and `entityIds` — the replay comparator reads either), so
    // a replay can be compared ID-by-ID instead of by count. Legs with no
    // entity IDs (demographics bands, overlap objects) carry no ID field at
    // all, so the comparator honestly reports "not comparable" for them
    // instead of matching on an empty list.
    const rawIds = Array.isArray(src?.results)
      ? src.results.map((r) => itemId(r))
      : (Array.isArray(src?.entities) ? src.entities.map((e) => e.id ?? null) : []);
    const receiptIds = rawIds.filter((id) => id !== null && id !== undefined);
    return receipts.add({
      claim,
      operation,
      // G17: MCP receipts hash the tool + arguments, REST receipts hash the
      // request URL — the two must never be confused. The manifest triple
      // (claim/operation/requestHash/requestId/resultCount) is unchanged.
      hashKind: src?._requestHash != null ? 'args' : (src?.requestHash ? 'url' : null),
      requestHash: src?.requestHash ?? src?._requestHash ?? null,
      requestId: src?.requestId ?? null,
      resultCount: overrides.resultCount ?? src?.resultCount ?? src?.result_count ?? (Array.isArray(src?.results) ? src.results.length : null),
      ...(receiptIds.length > 0 ? { ids: receiptIds, entityIds: receiptIds } : {}),
      replay: src?._replay ?? null,
    });
  };

  // G8/G47: overall verdict budget + client-abort. The budget is checked
  // between phases (a single live call is still bounded by its own timeout);
  // on expiry, or when the client disconnects, the run ends withheld with the
  // cause disclosed — never a partial verdict presented as complete.
  const budgetMs = deps.verdictBudgetMs ?? config.verdictBudgetMs ?? 90000;
  const deadline = started + budgetMs;
  const isCancelled = typeof deps.isCancelled === 'function' ? deps.isCancelled : () => false;
  const computeMissing = (ls) => {
    const missing = [];
    if (!(ls.findTags?.status === 'ok' || ls.describe?.status === 'ok')) missing.push('resolve (find_tags/describe)');
    if (!(ls.rank?.status === 'ok' || ls.recommend?.status === 'ok')) missing.push('rank-or-recommend');
    if (ls.wherePopular?.status !== 'ok') missing.push('where_popular');
    if (ls.demographics?.status !== 'ok') missing.push('demographics');
    if (!(ls.compare?.status === 'ok' || ls.entityTags?.status === 'ok')) missing.push('compare-or-entity_tags');
    return missing;
  };
  const withheldForAbort = (kind) => ({
    status: 'verdict_withheld',
    [kind]: true,
    message: kind === 'timeout'
      ? 'VERDICT WITHHELD — the run exceeded its overall time budget. No verdict numbers are shown from partial evidence.'
      : 'VERDICT WITHHELD — the client request closed before the run finished. No verdict numbers are shown from partial evidence.',
    missingLegs: computeMissing(legs),
    legs,
    receipts: receipts.all(),
    timingMs: Date.now() - started,
  });
  const checkAbort = () => {
    if (isCancelled()) return withheldForAbort('cancelled');
    // >=, not >: with a zero budget the deadline equals the start instant,
    // and a sub-millisecond run must still trip — a strict > would let a
    // run that finishes inside one clock tick slip past the budget.
    if (Date.now() >= deadline) return withheldForAbort('timeout');
    return null;
  };
  const throwIfGuardTrip = () => { if (guardError) throw guardError; };

  // Gate: readiness probe (reports readiness without calling Qloo data).
  let readiness = null;
  try {
    readiness = await call('qloo_capabilities', {});
    record('Qloo readiness probe', 'qloo_capabilities', readiness, { resultCount: Array.isArray(readiness?.operations) ? readiness.operations.length : null });
  } catch (e) {
    throw e; // fail closed: an unhealthy transport blocks the verdict
  }

  // G8 task helpers: every leg task catches its own failure and returns a
  // leg entry, so one leg's failure never kills the fan-out. Tasks are
  // applied in declared order, so receipt order is deterministic even though
  // legs settle in completion order. Only 'ok' legs leave a receipt.
  const applyTask = (t) => {
    legs[t.key] = t.leg;
    if (t.leg.status === 'ok' && t.receipt) record(t.receipt.claim, t.receipt.operation, t.receipt.src, t.receipt.overrides || {});
  };
  const mcpTask = async (key, tool, args, claim, build) => {
    try {
      const env = await call(tool, args);
      if (env?.status === 'needs_input') {
        return { key, leg: { status: 'needs_input', candidates: resultNames(env) }, receipt: null, env, needsInput: true };
      }
      const leg = mcpLeg(env, build);
      return { key, leg, receipt: leg.status === 'ok' ? { claim, operation: tool, src: env } : null, env };
    } catch (e) {
      return { key, leg: { status: 'error', reason: e.message }, receipt: null, env: null };
    }
  };
  const restTask = async (key, path, params, claim, build) => {
    try {
      const out = await rest(path, params);
      const leg = restLeg(out, build);
      return { key, leg, receipt: leg.status === 'ok' ? { claim, operation: `rest:${path}`, src: out } : null, out };
    } catch (e) {
      return { key, leg: { status: 'error', reason: e.message }, receipt: null, out: null };
    }
  };
  const runTasks = async (tasks) => {
    const settled = await Promise.allSettled(tasks);
    const done = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') { applyTask(s.value); done.push(s.value); }
    }
    return done;
  };

  // Resolve: tag-first path + headliner description. These two legs are
  // independent (neither consumes the other's output), so they fan out.
  const [findTagsTask, describeTask] = await runTasks([
    mcpTask('findTags', 'qloo_find_tags', { query: artist, limit: 10 }, 'headliner tags', (rs) => ({ results: namesOf(rs) })),
    mcpTask('describe', 'qloo_describe', { entity: input.entityHint || artist, type: 'artist' }, 'headliner description', (rs) => ({ headliner: rs[0] ? { id: itemId(rs[0]), name: itemName(rs[0]) } : null })),
  ]);
  const tags = findTagsTask.env;
  const describe = describeTask.env;
  if (describeTask.needsInput) {
    return {
      status: 'needs_input',
      message: 'The headliner name matched multiple entities. Pick the one you mean — the verdict never guesses.',
      candidates: describeTask.leg.candidates,
      receipts: receipts.all(),
      timingMs: Date.now() - started,
    };
  }
  throwIfGuardTrip();
  { const aborted = checkAbort(); if (aborted) return aborted; }
  const headliner = legs.describe?.headliner;
  const headlinerSignal = headliner?.id || headliner?.name || artist;
  // Gap 3 ID-threading: every evidence leg below takes the RESOLVED entity
  // ID when one is known, never a display name. describe already resolved
  // the headliner, so headlinerRef is ID-first by construction.
  const headlinerRef = headliner?.id || headlinerSignal;

  // Recommend + rank: opener candidates for the headliner. This IS the
  // resolve→describe→recommend→rank chain (G8): rank consumes recommend's
  // output, so these two stay sequential — never parallelised.
  const recommendTask = await mcpTask('recommend', 'qloo_recommend', { target_type: 'artist', signals: [headlinerSignal], limit: 10 }, 'opener candidates from headliner fans', (rs) => ({ candidates: namesOf(rs) }));
  applyTask(recommendTask);
  const recommend = recommendTask.env;
  throwIfGuardTrip();
  { const aborted = checkAbort(); if (aborted) return aborted; }
  const rankOptions = (legs.recommend?.candidates || []).map((c) => c.id || c.name).filter(Boolean);
  let rank = null;
  if (rankOptions.length > 0) {
    const rankTask = await mcpTask('rank', 'qloo_rank', { options: rankOptions, option_type: 'artist', signals: [headlinerRef], signal_location: city }, 'opener shortlist ranked for the city audience', (rs) => ({ ranked: namesOf(rs) }));
    applyTask(rankTask);
    rank = rankTask.env;
  } else {
    legs.rank = { status: 'skipped', reason: 'no opener candidates to rank' };
  }
  throwIfGuardTrip();
  { const aborted = checkAbort(); if (aborted) return aborted; }
  const topOpener = legs.rank?.ranked?.[0] || legs.recommend?.candidates?.[0] || null;
  const topOpenerSignal = topOpener ? topOpener.id || topOpener.name : null;
  // Gap 3 ID-threading (opener): a recommend/rank candidate that carries no
  // ID is resolved with one describe call, so compare/trends/REST legs
  // below take an ID instead of a display name. A failed or ambiguous
  // resolution keeps the name signal — never a guessed ID. This call is a
  // resolution helper, not a verdict leg, so it leaves no receipt; a guard
  // trip inside it is recorded by call() and rethrown below, fail-closed.
  let openerId = topOpener?.id || null;
  if (topOpener && !openerId && topOpener.name) {
    try {
      const resolved = await call('qloo_describe', { entity: topOpener.name, type: 'artist' });
      if (resolved && resolved.status !== 'needs_input' && Array.isArray(resolved.results) && resolved.results.length > 0) {
        openerId = itemId(resolved.results[0]);
      }
    } catch (e) {
      // Name-based fallback below; guard trips are rethrown by throwIfGuardTrip.
    }
  }
  const openerRef = openerId || topOpenerSignal;
  throwIfGuardTrip();
  { const aborted = checkAbort(); if (aborted) return aborted; }

  // Evidence legs (G8 fan-out): where_popular, demographics, overlap,
  // shared tags, trends, and the REST cross-checks consume only the resolve
  // + rank outputs already in hand — none consumes another evidence leg's
  // output, so they run together with allSettled semantics. G13 wires the
  // two previously dead REST legs (compare + entities hydrate) here too.
  const today = new Date();
  const start90 = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const urns = tags ? tagUrns(tags) : [];
  const headlinerId = legs.describe?.headliner?.id || null;
  const hydrateIds = [headlinerId, openerId].filter(Boolean);
  const evidenceTasks = [
    mcpTask('wherePopular', 'qloo_where_popular', { entity: headlinerRef, within: city, limit: 10 }, 'where the headliner is popular (city audience areas)', (rs) => ({ areas: namesOf(rs) })),
    mcpTask('demographics', 'qloo_audience_demographics', { entity: headlinerRef, entity_type: 'artist' }, 'audience demographic bands', (rs) => ({ bands: rs.slice(0, 20) })),
    mcpTask('entityTags', 'qloo_entity_tags', { entities: [headlinerRef, ...(topOpenerSignal ? [openerRef] : [])], entity_type: 'artist', limit: 10 }, 'top shared tags evidence', (rs) => ({ tags: rs.slice(0, 20) })),
    mcpTask('trends', 'qloo_trends', { entities: [headlinerRef], entity_type: 'artist', start_date: iso(start90), end_date: iso(today) }, 'headliner momentum (90-day trend)', (rs) => ({ points: rs.slice(0, 20) })),
    restTask('restSearch', '/search', { query: artist, take: 5 }, 'REST name resolution', (out) => ({ entities: out.entities || [] })),
  ];
  if (topOpenerSignal) {
    evidenceTasks.push(mcpTask('compare', 'qloo_compare_audiences', { group_a: [headlinerRef], group_b: [openerRef], target_type: 'artist' }, 'headliner-vs-opener audience overlap', (rs) => ({ result: rs.slice(0, 20) })));
  } else {
    legs.compare = { status: 'skipped', reason: 'no opener to compare against' };
  }
  if (urns.length > 0) {
    evidenceTasks.push(restTask('restInsights', '/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.tags': urns.join(','), 'feature.explainability': 'true' }, 'REST insights by tags with explainability', () => ({})));
  } else {
    legs.restInsights = { status: 'skipped', reason: 'no tag URNs resolved' };
  }
  if (headlinerId && openerId) {
    evidenceTasks.push(restTask('restCompare', '/v2/analysis/compare', { 'a.signal.interests.entities': headlinerId, 'b.signal.interests.entities': openerId }, 'REST headliner-vs-opener audience comparison', () => ({})));
  } else {
    legs.restCompare = { status: 'skipped', reason: 'no headliner + opener entity IDs to compare' };
  }
  if (hydrateIds.length > 0) {
    evidenceTasks.push(restTask('restEntities', '/entities', { entity_ids: hydrateIds.slice(0, 15).join(',') }, 'REST entity hydration', (out) => ({ entities: out.entities || [] })));
  } else {
    legs.restEntities = { status: 'skipped', reason: 'no entity IDs to hydrate' };
  }
  await runTasks(evidenceTasks);

  // Guard trip recorded during any leg: fail the whole run closed now, before
  // the gate can downgrade it to a 200 verdict_withheld.
  throwIfGuardTrip();
  { const aborted = checkAbort(); if (aborted) return aborted; }

  // S1 GATE: required legs must all be ok. Anything else -> WITHHELD, no numbers.
  // G5: a leg counts ONLY at status 'ok' — partial/degraded/empty never count.
  const requiredOk = computeMissing(legs).length === 0;
  if (!requiredOk) {
    return {
      status: 'verdict_withheld',
      message: 'VERDICT WITHHELD — Qloo evidence is incomplete. No verdict numbers are shown from partial evidence.',
      missingLegs: computeMissing(legs),
      legs,
      receipts: receipts.all(),
      timingMs: Date.now() - started,
    };
  }

  // Ticketmaster + OSM + Wikidata legs (G8 fan-out): none consumes another's
  // output, so they run together. All are best-effort, never blocking.
  let tmState = { status: 'not_configured', cause: 'not_configured', note: 'Ticketmaster key not configured — capacity leg unavailable' };
  let tmCapacity = null;
  let tmPrice = null;
  let tmEventsCount = null;
  let tmVenueResolved = false;
  // G14 scope labels — the role each leg plays, never a claim it changes a
  // verdict number. OSM/Wikidata data is display / Web-arm input only.
  const osmScope = 'display-only — shown for confirmation, never fed into Qloo filters';
  const wikidataScope = 'input to the Web arm only, never a direct verdict input';
  let osmState = { status: 'skipped', note: 'geocoding leg not wired', scope: osmScope };
  let wikidataState = { status: 'skipped', note: 'fact cross-check leg not wired', scope: wikidataScope };
  let webFacts = [];
  const tmTask = async () => {
    if (!config.tmKeyConfigured || !deps.tmEvents) return;
    try {
      // G11: resolve the promoter's named room first, when one was entered
      // and a venue-search transport is wired. A failed/unresolved search
      // never blocks the verdict — it falls back to first-event behavior,
      // labeled as such below.
      let venueId = null;
      let resolvedVenue = null;
      let venueSearchNote = null;
      if (venueQuery && deps.tmVenues) {
        try {
          const vs = await deps.tmVenues({ keyword: venueQuery });
          if (vs.ok) {
            resolvedVenue = extractFirstVenueResult(vs.body);
            if (resolvedVenue) {
              tmVenueResolved = true;
              venueId = resolvedVenue.id ?? resolvedVenue.venueId ?? null;
            } else {
              venueSearchNote = `named room '${venueQuery}' did not resolve in Ticketmaster venue search`;
            }
          } else {
            venueSearchNote = `Ticketmaster venue search returned ${vs.status} for '${venueQuery}'`;
          }
        } catch (e) {
          venueSearchNote = `Ticketmaster venue search failed for '${venueQuery}': ${e.message}`;
        }
      } else if (venueQuery && !deps.tmVenues) {
        venueSearchNote = 'venue search not wired, so the named room could not be resolved';
      }
      const ev = await deps.tmEvents({ keyword: artist, city, ...(venueId ? { venueId } : {}) });
      if (ev.ok) {
        tmEventsCount = Array.isArray(ev.body?._embedded?.events) ? ev.body._embedded.events.length : 0;
        const venue = extractFirstVenue(ev.body);
        // A resolved room's own capacity grounds the verdict; a scoped
        // event's embedded venue is the same room, so it may fill a gap in
        // the venue-search record. The first-event fallback path below never
        // borrows another room's capacity when a room was named and resolved.
        tmCapacity = tmVenueResolved
          ? (extractCapacity(resolvedVenue) ?? extractCapacity(venue))
          : extractCapacity(venue);
        tmPrice = extractPrice(ev.body);
        const grounding = tmVenueResolved
          ? 'named room — venue resolved by Ticketmaster venue search'
          : `first matching Ticketmaster event's venue, not the offer room${venueSearchNote ? ` (${venueSearchNote})` : ''}`;
        tmState = { status: 'ok', eventsFound: tmEventsCount, venueName: (tmVenueResolved ? resolvedVenue?.name : venue?.name) ?? null, capacityReported: tmCapacity !== null, venueQuery: venueQuery || null, venueResolved: tmVenueResolved, grounding };
      } else {
        tmState = { status: 'error', cause: 'error', reason: `Ticketmaster returned ${ev.status}` };
      }
    } catch (e) {
      tmState = { status: 'error', cause: 'error', reason: e.message };
    }
  };
  const osmTask = async () => {
    if (!deps.geocodeFn) return;
    try {
      const g = await deps.geocodeFn({ query: city });
      osmState = g.ok && g.result
        ? { status: 'ok', displayName: g.result.displayName, lat: g.result.lat, lon: g.result.lon, scope: osmScope }
        : { status: 'unavailable', note: 'city used as typed; location filters omitted', scope: osmScope };
    } catch (e) {
      osmState = { status: 'error', reason: e.message, scope: osmScope };
    }
  };
  const wikidataTask = async () => {
    if (!deps.wikidataFn) return;
    try {
      const w = await deps.wikidataFn({ query: artist });
      wikidataState = w.ok
        ? { status: 'ok', matches: w.results, scope: wikidataScope }
        : { status: 'error', reason: `Wikidata returned ${w.status}`, scope: wikidataScope };
      webFacts = (w.results || []).map((r) => `${r.label}${r.description ? ` — ${r.description}` : ''} (${r.id})`);
    } catch (e) {
      wikidataState = { status: 'error', reason: e.message, scope: wikidataScope };
    }
  };
  await Promise.allSettled([tmTask(), osmTask(), wikidataTask()]);
  throwIfGuardTrip();
  { const aborted = checkAbort(); if (aborted) return aborted; }

  // G24: capacity carries its cause, with a distinct message per cause.
  // Only an actually-fetched venue record lacking the field may use the
  // "returned no capacity for this room" wording (MAX §2.6 verbatim).
  const capacityCause = !config.tmKeyConfigured
    ? 'not_configured'
    : (tmState.status === 'error' ? 'error' : 'no_field');
  const capacityUnknownMessage = capacityCause === 'not_configured'
    ? 'Capacity leg not configured — Ticketmaster key not configured.'
    : (capacityCause === 'error'
      ? 'Ticketmaster unavailable — capacity and event history not loaded'
      : 'Venue capacity unknown — Ticketmaster returned no capacity for this room. Break-even is shown as tickets needed, not as a sellout percentage. Verify room size before signing.');
  const unknownCapacity = {
    value: null,
    source: null,
    state: 'unknown',
    cause: capacityCause,
    message: capacityUnknownMessage,
  };

  // Price resolution: user price first (labeled), then Ticketmaster (labeled).
  let price = null;
  let priceSource = null;
  if (typeof input.ticketPrice === 'number' && Number.isFinite(input.ticketPrice) && input.ticketPrice > 0) {
    price = input.ticketPrice;
    priceSource = 'user-supplied';
  } else if (tmPrice) {
    price = tmPrice.price;
    // G11: a Ticketmaster price is only the offer room's price when the
    // event lookup was scoped to a resolved room. Otherwise it is the
    // first matching event's price, labeled as such — never silently the
    // promoter's room price.
    priceSource = tmVenueResolved
      ? `${tmPrice.source} — events at the named room`
      : `${tmPrice.source} — first matching Ticketmaster event's venue, not the offer room`;
  }
  if (!price) {
    // G43: price_unknown still returns the available Qloo evidence in a
    // clearly-labeled `partial` object — audience + openers + legs — so it
    // can be shown as partial evidence. No break-even number is included:
    // the verdict number itself must NOT render in this state.
    const partialTop = legs.rank?.ranked?.[0] || legs.recommend?.candidates?.[0] || null;
    return {
      status: 'price_unknown',
      message: 'No ticket price available — neither the promoter nor Ticketmaster supplied one. Break-even cannot be computed without inventing a number.',
      capacity: unknownCapacity,
      partial: {
        label: 'Partial Qloo evidence — not a verdict. No break-even number is shown without a ticket price.',
        audience: legs.wherePopular?.status === 'ok'
          ? {
              areas: legs.wherePopular.areas,
              areasCount: legs.wherePopular.areas.length,
              note: 'Qloo returns matched areas/entities, not a headcount — no population number is claimed.',
            }
          : null,
        openers: {
          ranked: legs.rank?.ranked || [],
          candidates: legs.recommend?.candidates || [],
          topPick: partialTop?.name || null,
        },
        demographics: legs.demographics?.status === 'ok' ? legs.demographics.bands : null,
        trends: legs.trends?.status === 'ok' ? legs.trends.points : null,
        sharedTags: legs.entityTags?.status === 'ok' ? legs.entityTags.tags : null,
        overlap: legs.compare?.status === 'ok' ? legs.compare.result : null,
        legs,
      },
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
    // G11: same grounding rule as price — a resolved room keeps the plain
    // Ticketmaster-reported label; the first-event fallback carries the
    // honest "not the offer room" suffix wherever it renders.
    capacitySource = tmVenueResolved
      ? 'Ticketmaster-reported'
      : `Ticketmaster-reported — first matching Ticketmaster event's venue, not the offer room`;
  }

  const be = breakEven({ guarantee, ticketPrice: price, variableCost, capacity });
  const graphPick = topOpener?.name || null;

  // Arms: Gut + Web (unavailable when no LLM is configured — never fabricated).
  // G8 fan-out: the Web arm consumes Wikidata facts, but Gut does not — the
  // two arms run together once the facts are in hand.
  const question = `Headliner ${artist} in ${city}. Who is the best opening act for this audience?`;
  const [gut, web] = await Promise.all([
    deps.gutArm
      ? deps.gutArm({ question }).catch((e) => ({ arm: 'gut', status: 'error', reason: e.message }))
      : Promise.resolve({ arm: 'gut', status: 'unavailable', reason: 'arm not wired' }),
    deps.webArm
      ? deps.webArm({ question, webFacts }).catch((e) => ({ arm: 'web', status: 'error', reason: e.message }))
      : Promise.resolve({ arm: 'web', status: 'unavailable', reason: 'arm not wired' }),
  ]);
  { const aborted = checkAbort(); if (aborted) return aborted; }
  const gutPick = gut.status === 'ok' ? gut.pick : null;
  const webPick = web.status === 'ok' ? web.pick : null;
  // Phase 3 Wave 2 (E): every miss carries its taxonomy code, computed
  // from this run's own ranked + candidate sets — no new model call, no
  // invented reason. The ranked/candidate sets travel on the verdict, so
  // the frontend renders the same codes without recomputing a new reason.
  const rawMisses = [
    ...(gutPick && gutPick !== graphPick ? [{ arm: 'gut', pick: gutPick, graphPick }] : []),
    ...(webPick && webPick !== graphPick ? [{ arm: 'web', pick: webPick, graphPick }] : []),
  ];
  const missTaxonomy = classifyMisses(rawMisses, {
    artist,
    ranked: legs.rank?.ranked || [],
    candidates: legs.recommend?.candidates || [],
    setsRecorded: (legs.rank?.ranked?.length > 0) || (legs.recommend?.candidates?.length > 0),
  });
  const missTrial = (gutPick || webPick) && graphPick
    ? {
        question,
        graphPick,
        gutPick,
        webPick,
        misses: missTaxonomy.misses,
        taxonomy: { counts: missTaxonomy.counts, total: missTaxonomy.total },
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
      // G12: blank vs explicit cost travels with the verdict — the UI
      // renders blank as "before variable costs", explicit 0 as cost 0.
      variableCost: { value: variableCostProvided ? variableCost : null, provided: variableCostProvided },
    },
    capacity: capacity === null
      ? unknownCapacity
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
