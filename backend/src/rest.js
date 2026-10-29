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

// G6: replay allowlist — the ONLY REST paths a replay may re-run. Any other
// path (including an absolute URL, which would otherwise override baseUrl)
// is rejected before any call is made.
export const REST_PATHS = ['/search', '/v2/insights', '/v2/analysis/compare', '/entities'];

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
}) {
  // G6 defense-in-depth: only relative paths may reach the host. An absolute
  // URL passed as `path` would override baseUrl in `new URL(path, baseUrl)`
  // and send the key to an attacker-chosen host — reject it outright.
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('://') || path.startsWith('//')) {
    throw new Error('Qloo REST path must be a relative path');
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
        const retryAfter = Number(res.headers?.get?.('Retry-After') || 0);
        await sleep(Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, 10000));
        continue;
      }
      const entities = Array.isArray(body?.entities) ? body.entities : [];
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        body,
        requestHash,
        requestId: body?.requestId ?? body?.request_id ?? res.headers?.get?.('x-request-id') ?? null,
        resultCount: entities.length || body?.result_count || null,
        entities: entities.map((e) => ({ id: extractId(e), name: extractName(e) })).filter((e) => e.id || e.name),
      };
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      if (attempt === 0 && (e.name === 'AbortError' || e.message?.includes('fetch'))) {
        // Network/timeout on first attempt: one retry, then surface the failure.
        continue;
      }
      throw new Error(`Qloo REST call failed: ${e.message}`);
    }
  }
  throw new Error(`Qloo REST call failed: ${lastError?.message || 'unknown'}`);
}

// REST legs used by the verdict pipeline (cross-checks the MCP legs).
export async function restSearch({ query, take = 5, key, baseUrl, fetchImpl }) {
  return qlooRest({ path: '/search', params: { query, take }, key, baseUrl, fetchImpl });
}

export async function restInsightsByTags({ tagUrns, filterType = 'urn:entity:artist', key, baseUrl, fetchImpl }) {
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
  });
}

export async function restCompare({ aIds, bIds, key, baseUrl, fetchImpl }) {
  return qlooRest({
    path: '/v2/analysis/compare',
    params: {
      'a.signal.interests.entities': aIds.join(','),
      'b.signal.interests.entities': bIds.join(','),
    },
    key,
    baseUrl,
    fetchImpl,
  });
}

export async function restEntities({ ids, key, baseUrl, fetchImpl }) {
  // Max 15 per call (adopted from TasteCase's BoundedQlooClient).
  const slice = ids.slice(0, 15);
  return qlooRest({
    path: '/entities',
    params: { entity_ids: slice.join(',') },
    key,
    baseUrl,
    fetchImpl,
  });
}
