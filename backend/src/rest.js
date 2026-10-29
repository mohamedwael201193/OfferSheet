// REST client for the Qloo hackathon host — GET only, X-Api-Key header only.
// Rules honored: hackathon host ONLY (staging/production always 401 with a hackathon
// key); GET with query string only (POST with a JSON body fails); 25s timeout;
// exactly one retry on 429/5xx honoring Retry-After where present; legacy
// /recommendations and /recs are never called. The key travels only in the header —
// never in the URL (so it can never leak into a hashed receipt URL or a log).
// Response shapes: the guide renders no full example JSON, so parsing is defensive:
// entity IDs and counts are extracted best-effort; an unparseable leg is labeled
// (status 'unparsed'), never guessed.
import { requestHashFor } from './receipts.js';
import { invalidInput } from './errors.js';

// G6: replay allowlist — the ONLY REST paths a replay may re-run. Any other
// path (including an absolute URL, which would otherwise override baseUrl)
// is rejected before any call is made.
export const REST_PATHS = ['/search', '/v2/insights', '/v2/analysis/compare', '/entities'];

// G3 (superiority): per-path parameter allowlist, enforced in the single
// REST caller below — so verdict legs AND replay pass through the same
// gate. A typo'd or unallowlisted param fails closed BEFORE any call is
// made, and a replay carrying an unallowlisted param is rejected with a
// 400, never sent to Qloo under a receipt. This closes the
// silent-unfiltered-data-under-receipt risk: without it, a mistyped
// filter param would silently return unfiltered data that still earned a
// receipt. The keys below are exactly the sets the four wrappers send.
export const REST_PARAM_ALLOWLIST = {
  '/search': ['query', 'take'],
  '/v2/insights': ['filter.type', 'signal.interests.tags', 'feature.explainability'],
  '/v2/analysis/compare': ['a.signal.interests.entities', 'b.signal.interests.entities'],
  '/entities': ['entity_ids'],
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractId(item) {
  if (!item || typeof item !== 'object') return null;
  return item.entity_id ?? item.id ?? item.uuid ?? null;
}

function extractName(item) {
  if (!item || typeof item !== 'object') return null;
  return item.name ?? item.properties?.name ?? null;
}

export async function qlooRest({
  path,
  params = {},
  key,
  baseUrl,
  timeoutMs = 25000,
  fetchImpl = fetch,
  // Server-side-only diagnostics: called with { path, status, bodyKeys,
  // resultCount } on every terminal outcome. NEVER the URL (query params),
  // never headers, never the body — so no key, tag, or artist string can
  // reach a log. The diagnostic object is never returned to the client.
  logFn = null,
}) {
  // G6 defense-in-depth: only relative paths may reach the host. An absolute
  // URL passed as `path` would override baseUrl in `new URL(path, baseUrl)`
  // and send the key to an attacker-chosen host — reject it outright.
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('://') || path.startsWith('//')) {
    throw new Error('Qloo REST path must be a relative path');
  }
  // G3: per-path param allowlist + pinned filter.type for /v2/insights.
  // Checked before any fetch: an unallowlisted key (typo or replay-injected),
  // a missing filter.type, or any filter.type other than the artist entity
  // type fails closed here, never under a receipt. The pin is exact, not
  // merely non-empty: every in-tree caller (verdict leg, MCP tool, both
  // replay paths) sends urn:entity:artist, and a replay carrying any other
  // filter.type would otherwise return differently-filtered data under a
  // receipt claiming the intended filter.
  const allowedParams = REST_PARAM_ALLOWLIST[path];
  if (!allowedParams) {
    throw invalidInput(`Qloo REST path not allowlisted: ${path}`);
  }
  for (const k of Object.keys(params)) {
    if (!allowedParams.includes(k)) {
      throw invalidInput(`Qloo REST param not allowlisted for ${path}: ${k}`);
    }
  }
  if (path === '/v2/insights') {
    const ft = params['filter.type'];
    if (ft !== 'urn:entity:artist') {
      throw invalidInput('Qloo REST /v2/insights requires filter.type urn:entity:artist');
    }
  }
  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  const requestHash = requestHashFor('GET', url.toString());
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: { 'X-Api-Key': key, Accept: 'application/json' },
        redirect: 'manual',
        signal: controller.signal,
      });
      clearTimeout(timer);
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        // Retry-After may be delay-seconds OR an HTTP-date; both forms
        // are honored, and either way the wait is capped at 10s and
        // floored at 0 (a past date retries immediately, never sleeps
        // negative). Exactly one retry total: this branch runs only on
        // attempt 0 of the 2-attempt loop.
        const rawAfter = res.headers?.get?.('Retry-After');
        const secs = Number(rawAfter);
        const dateMs = rawAfter ? Date.parse(rawAfter) : NaN;
        const waitMs = Number.isFinite(secs) ? secs * 1000
          : (Number.isFinite(dateMs) ? dateMs - Date.now() : 0);
        await sleep(Math.max(0, Math.min(waitMs, 10000)));
        continue;
      }
      const entities = extractList(body);
      const resultCount = entities.length || body?.result_count || body?.total_count || body?.total || null;
      // Payload test for non-list bodies (e.g. /v2/analysis/compare returns
      // a comparison object, not a list): a 2xx body with non-error keys is
      // a real payload and earns a receipt; a list-shaped body earns one
      // only from its list/count. An empty list, an empty object, or an
      // error body never earns one.
      const isListShaped = body !== null && typeof body === 'object' && ('entities' in body || 'results' in body);
      const hasErrorKey = body !== null && typeof body === 'object' && !Array.isArray(body) && ('error' in body || 'errors' in body);
      const payloadPresent = isListShaped
        ? (entities.length > 0 || (resultCount !== null && resultCount > 0))
        : (!hasErrorKey && body !== null && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length > 0);
      if (typeof logFn === 'function') {
        try { logFn({ path, status: res.status, bodyKeys: bodyKeysOf(body), resultCount }); } catch { /* logging never breaks a call */ }
      }
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        body,
        requestHash,
        requestId: body?.requestId ?? body?.request_id ?? res.headers?.get?.('x-request-id') ?? null,
        resultCount,
        entities: entities.map((e) => ({ id: extractId(e), name: extractName(e) })).filter((e) => e.id || e.name),
        payloadPresent,
      };
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      if (attempt === 0 && (e.name === 'AbortError' || e.message?.includes('fetch'))) {
        // Network/timeout on first attempt: one retry, then surface the failure.
        continue;
      }
      if (typeof logFn === 'function') {
        try { logFn({ path, status: null, bodyKeys: [], resultCount: null }); } catch { /* logging never breaks a call */ }
      }
      throw new Error(`Qloo REST call failed: ${e.message}`);
    }
  }
  throw new Error(`Qloo REST call failed: ${lastError?.message || 'unknown'}`);
}

// REST legs used by the verdict pipeline (cross-checks the MCP legs).
//
// Shape note (Gap 2, live-audit finding): the live /search envelope carries
// its list under `results`, not `entities` — a parser that only read
// `entities` silently emptied every REST leg even on HTTP 200. The parser
// below accepts EITHER list key, and a 2xx object body with no list at all
// (e.g. /v2/analysis/compare) still counts as a payload when it carries
// non-error keys. An empty list with no count and no object payload is
// 'empty', never 'ok' — G16 unchanged.
function extractList(body) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.entities)) return body.entities;
  if (Array.isArray(body.results)) return body.results;
  return [];
}

function bodyKeysOf(body) {
  if (body === null || body === undefined) return [];
  if (Array.isArray(body)) return ['<array>'];
  if (typeof body === 'object') return Object.keys(body);
  return [];
}
export async function restSearch({ query, take = 5, key, baseUrl, fetchImpl, logFn }) {
  return qlooRest({ path: '/search', params: { query, take }, key, baseUrl, fetchImpl, logFn });
}

export async function restInsightsByTags({ tagUrns, filterType = 'urn:entity:artist', key, baseUrl, fetchImpl, logFn }) {
  return qlooRest({
    path: '/v2/insights',
    params: {
      'filter.type': filterType,
      'signal.interests.tags': tagUrns.join(','),
      'feature.explainability': 'true',
    },
    key,
    baseUrl,
    fetchImpl,
    logFn,
  });
}

export async function restCompare({ aIds, bIds, key, baseUrl, fetchImpl, logFn }) {
  return qlooRest({
    path: '/v2/analysis/compare',
    params: {
      'a.signal.interests.entities': aIds.join(','),
      'b.signal.interests.entities': bIds.join(','),
    },
    key,
    baseUrl,
    fetchImpl,
    logFn,
  });
}

export async function restEntities({ ids, key, baseUrl, fetchImpl, logFn }) {
  // Max 15 per call (bounded client cap).
  const slice = ids.slice(0, 15);
  return qlooRest({
    path: '/entities',
    params: { entity_ids: slice.join(',') },
    key,
    baseUrl,
    fetchImpl,
    logFn,
  });
}
