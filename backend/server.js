// OfferSheet backend — zero-dependency Node HTTP server.
// Serves the one-page frontend statically and exposes the verdict API.
// Same-origin only: no CORS headers, so the browser page can call /api/* but
// no other origin can. Logs method/path/status only — never bodies or keys.
// Keys come from the host environment only (Render service env at deploy time):
// QLOO_API_KEY, TICKETMASTER_API_KEY, LLM_* — never from the repo or the client.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './src/config.js';
import { Guards, visitorIpFor } from './src/guards.js';
import { ReceiptStore } from './src/receipts.js';
import { McpSession, MCP_TOOLS, validateMcpReplayArgs } from './src/mcp.js';
import { qlooRest, REST_PATHS, REST_PARAM_ALLOWLIST } from './src/rest.js';
import { searchEvents, searchVenues } from './src/ticketmaster.js';
import { geocode } from './src/osm.js';
import { geocodeCities } from './src/geostrip.js';
import { searchEntities } from './src/wikidata.js';
import { runGutArm, runWebArm, llmConfigured } from './src/arms.js';
import { runVerdict } from './src/pipeline.js';
import { OfferError, notConfigured, invalidInput } from './src/errors.js';
import { buildRerankArgs, formatRerankResult } from './src/rerank.js';
import { argsHashFor } from './src/receipts.js';
import {
  verifyWorkspace,
  computeRenegotiation,
  computeEnvelope,
  computeSettlement,
  runReplacement,
  runRouting,
  runComparison,
  stepRefusal,
} from './src/workspace.js';

const FRONTEND_DIR = fileURLToPath(new URL('../frontend/', import.meta.url));
const BENCH_FILE = fileURLToPath(new URL('../bench/results.json', import.meta.url));
const guards = new Guards({
  monthlyBudget: config.monthlyCallBudget,
  perVisitorDailyCap: config.perVisitorDailyCap,
  perRunCallCap: config.perRunCallCap,
});

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(payload);
}

function sendError(res, err) {
  if (err instanceof OfferError) {
    send(res, err.status, { error: { code: err.code, message: err.message } });
  } else {
    send(res, 500, { error: { code: 'INTERNAL', message: 'Internal error' } });
  }
}

// REST diagnostics (Gap 2, server-side only): path + status + top-level
// body keys + result count, to stderr. Never the URL (query params carry
// artist/tag strings), never headers, never the body — so no key or artist
// string can reach a log, and nothing diagnostic ever enters a client
// payload (the log object is never returned, only passed to logFn).
function restLog(info) {
  try {
    console.error(`[qloo-rest] ${JSON.stringify(info)}`);
  } catch {
    // Logging must never break a call.
  }
}

function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limit) {
        reject(new OfferError('BODY_TOO_LARGE', 413, 'Request body exceeds 64KB'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new OfferError('INVALID_INPUT', 400, 'Request body must be a JSON object');
    }
    return parsed;
  } catch (e) {
    if (e instanceof OfferError) throw e;
    throw new OfferError('INVALID_INPUT', 400, 'Request body is not valid JSON');
  }
}

async function buildDeps({ gutArm, webArm, isCancelled } = {}) {
  const session = new McpSession({
    command: config.qlooMcpCommand,
    args: ['mcp'],
    timeoutMs: config.mcpTimeoutMs,
  });
  let started = false;
  const mcpCall = async (tool, args) => {
    if (!started) {
      await session.start();
      started = true;
    }
    return session.call(tool, args);
  };
  return {
    deps: {
      config,
      guards,
      receipts: new ReceiptStore(),
      checkCall: () => guards.checkCall(),
      checkVisitor: (ip) => guards.checkVisitor(ip),
      isCancelled: isCancelled || (() => false),
      mcpCall,
      restCall: ({ path, params }) => qlooRest({
        path, params, key: config.qlooKey, baseUrl: config.qlooBaseUrl, timeoutMs: config.restTimeoutMs, logFn: restLog,
      }),
      tmEvents: ({ keyword, city }) => searchEvents({
        keyword, city, key: config.ticketmasterKey, baseUrl: config.ticketmasterBaseUrl,
      }),
      // G11 production wiring: the pipeline resolves a named room first
      // (deps.tmVenues) and scopes events by that venue's ID. Without this
      // line the pipeline falls back — honestly labeled — to first-event
      // grounding and notes "venue search not wired".
      tmVenues: ({ keyword }) => searchVenues({
        keyword, key: config.ticketmasterKey, baseUrl: config.ticketmasterBaseUrl,
      }),
      geocodeFn: ({ query }) => geocode({ query, baseUrl: config.osmBaseUrl }),
      wikidataFn: ({ query }) => searchEntities({ query, baseUrl: config.wikidataBaseUrl }),
      gutArm: gutArm || (({ question }) => runGutArm({ question })),
      webArm: webArm || (({ question, webFacts }) => runWebArm({ question, webFacts })),
    },
    close: () => session.close(),
  };
}

async function handleVerdict(req, res, { race = false } = {}) {
  const input = await readJsonBody(req);
  const visitorIp = visitorIpFor(req);
  // G47: abort the pipeline when the client request closes. The flag is
  // checked between legs; a run aborted this way ends withheld, never
  // presented as a partial verdict.
  let cancelled = false;
  req.on('close', () => { cancelled = true; });
  let gutMs = null;
  let webMs = null;
  let gutArm;
  let webArm;
  if (race) {
    gutArm = async ({ question }) => {
      const t0 = Date.now();
      const out = await runGutArm({ question });
      gutMs = Date.now() - t0;
      return out;
    };
    webArm = async ({ question, webFacts }) => {
      const t0 = Date.now();
      const out = await runWebArm({ question, webFacts });
      webMs = Date.now() - t0;
      return out;
    };
  }
  const { deps, close } = await buildDeps({ gutArm, webArm, isCancelled: () => cancelled });
  try {
    const verdict = await runVerdict({ ...input, visitorIp }, deps);
    if (race) {
      send(res, 200, { ...verdict, race: { gutMs, webMs, totalMs: verdict.timingMs } });
    } else {
      send(res, 200, verdict);
    }
  } finally {
    close();
  }
}

// G7: ordered entity IDs from a replayed run, so the frontend compares IDs
// + order, not counts only. MCP envelopes and REST bodies both carry
// entity_id/id/uuid shapes; names are kept alongside for display only.
function orderedEntityIds(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => (it && typeof it === 'object' ? (it.entity_id ?? it.id ?? it.uuid ?? null) : null))
    .filter((id) => id !== null);
}

async function handleReplay(req, res) {
  const body = await readJsonBody(req);
  if (!config.qlooKeyConfigured) throw notConfigured();
  // G6: replay is a live-call endpoint, so it is guarded like a verdict leg
  // (per-visitor cap + call budget) — an unguarded replay would be an
  // unbounded key-spending hole. The key gate above precedes validation:
  // a keyless bogus replay still fails closed, never replays.
  const visitorIp = visitorIpFor(req);
  if (body.kind === 'mcp' && typeof body.tool === 'string') {
    if (!MCP_TOOLS.includes(body.tool)) {
      throw new OfferError('INVALID_INPUT', 400, `Replay tool not allowlisted: ${body.tool}`);
    }
    if (body.args !== undefined && (typeof body.args !== 'object' || body.args === null || Array.isArray(body.args))) {
      throw new OfferError('INVALID_INPUT', 400, 'Replay MCP args must be an object');
    }
    // T1: per-tool arg-key validation BEFORE guards and before any session
    // is spawned — an unallowlisted key never spends guard budget and never
    // reaches the upstream, where a silently ignored key could stamp a
    // false ID match on a different call.
    validateMcpReplayArgs(body.tool, body.args || {});
    guards.checkVisitor(visitorIp);
    guards.checkCall();
    const session = new McpSession({
      command: config.qlooMcpCommand,
      args: ['mcp'],
      timeoutMs: config.mcpTimeoutMs,
    });
    try {
      await session.start();
      const envelope = await session.call(body.tool, body.args || {});
      const results = Array.isArray(envelope?.results) ? envelope.results : [];
      // T1: like-with-like result count. The readiness envelope carries its
      // list under `operations`, not `results` — counting results.length
      // would report 0 against a recorded 9 and mislead the comparator's
      // count note. requestHash lets the frontend prove the replayed call
      // IS the recorded call (call fidelity), distinct from result equality.
      const operationsCount = Array.isArray(envelope?.operations) ? envelope.operations.length : null;
      send(res, 200, {
        kind: 'mcp',
        tool: body.tool,
        envelope,
        requestHash: argsHashFor(body.tool, body.args || {}),
        // Both names: the replay comparator reads `ids` first, `entityIds` second.
        ids: orderedEntityIds(results),
        entityIds: orderedEntityIds(results),
        resultCount: envelope?.result_count ?? operationsCount ?? results.length,
      });
    } finally {
      session.close();
    }
    return;
  }
  if (body.kind === 'rest' && typeof body.path === 'string') {
    // Absolute URLs are rejected before the allowlist check: a replayed
    // absolute URL would otherwise redirect the keyed call off-host.
    if (!body.path.startsWith('/') || body.path.includes('://') || body.path.startsWith('//')) {
      throw new OfferError('INVALID_INPUT', 400, 'Replay REST paths must be relative paths');
    }
    if (!REST_PATHS.includes(body.path)) {
      throw new OfferError('INVALID_INPUT', 400, `Replay REST path not allowlisted: ${body.path}`);
    }
    if (body.params !== undefined && (typeof body.params !== 'object' || body.params === null || Array.isArray(body.params))) {
      throw new OfferError('INVALID_INPUT', 400, 'Replay REST params must be an object');
    }
    // T1: REST param validation BEFORE guards, mirroring the caller gate
    // in qlooRest (which stays the authoritative gate — this pre-check only
    // stops an invalid replay from spending guard budget before it fails).
    // Without it, an unallowlisted param consumed budget, then failed
    // inside qlooRest; the call itself never reached Qloo either way.
    {
      const allowedParams = REST_PARAM_ALLOWLIST[body.path] || [];
      for (const k of Object.keys(body.params || {})) {
        if (!allowedParams.includes(k)) {
          throw new OfferError('INVALID_INPUT', 400, `Replay REST param not allowlisted for ${body.path}: ${k}`);
        }
      }
      if (body.path === '/v2/insights') {
        const ft = (body.params || {})['filter.type'];
        if (ft !== 'urn:entity:artist') {
          throw new OfferError('INVALID_INPUT', 400, 'Replay REST /v2/insights requires filter.type urn:entity:artist');
        }
      }
    }
    guards.checkVisitor(visitorIp);
    guards.checkCall();
    const result = await qlooRest({
      path: body.path,
      params: body.params || {},
      key: config.qlooKey,
      baseUrl: config.qlooBaseUrl,
      timeoutMs: config.restTimeoutMs,
      logFn: restLog,
    });
    send(res, 200, {
      kind: 'rest',
      path: body.path,
      result,
      requestHash: result.requestHash,
      // Both names: the replay comparator reads `ids` first, `entityIds` second.
      ids: orderedEntityIds(result.entities),
      entityIds: orderedEntityIds(result.entities),
      resultCount: result.resultCount,
    });
    return;
  }
  throw new OfferError('INVALID_INPUT', 400, 'Replay requires kind mcp (tool + args) or kind rest (path + params)');
}

// ---- Deal-workspace endpoints (LEGENDARY Phase 2) ----
// Stateless: every step handler takes the client-held workspace, verifies
// it via workspace.js, and returns a step result. Nothing is stored, and a
// refused step writes nothing. Logs stay method/path/status only (router).
function sendStepRefused(res, step, err, detail) {
  const status = err instanceof OfferError ? err.status : 502;
  const code = err instanceof OfferError ? err.code : 'QLOO_ERROR';
  send(res, status, stepRefusal(step, code, err.message || 'Step failed', detail || `step ${step} refused`));
}

function workspaceAndInput(body) {
  if (!body.workspace || typeof body.workspace !== 'object' || Array.isArray(body.workspace)) {
    throw new OfferError('INVALID_INPUT', 400, 'workspace must be a JSON object');
  }
  return { workspace: body.workspace, stepInput: body.stepInput ?? {} };
}

async function handleWorkspaceVerify(req, res) {
  const body = await readJsonBody(req);
  if (!body.workspace || typeof body.workspace !== 'object' || Array.isArray(body.workspace)) {
    throw new OfferError('INVALID_INPUT', 400, 'workspace must be a JSON object');
  }
  send(res, 200, verifyWorkspace(body.workspace, { baseUrl: config.qlooBaseUrl }));
}

async function handlePureWorkspaceStep(req, res, step, fn) {
  try {
    const body = await readJsonBody(req);
    const { workspace, stepInput } = workspaceAndInput(body);
    send(res, 200, fn(workspace, stepInput, { baseUrl: config.qlooBaseUrl }));
  } catch (e) {
    if (e instanceof OfferError) { sendStepRefused(res, step, e, e.message); return; }
    throw e;
  }
}

async function handleReplacement(req, res) {
  const step = 'replacement';
  let close = () => {};
  try {
    const body = await readJsonBody(req);
    const { workspace, stepInput } = workspaceAndInput(body);
    const visitorIp = visitorIpFor(req);
    const built = await buildDeps({ isCancelled: () => req.socket?.destroyed === true });
    close = built.close;
    const out = await runReplacement(workspace, stepInput, built.deps, { visitorIp });
    send(res, 200, out);
  } catch (e) {
    if (e instanceof OfferError) { sendStepRefused(res, step, e, e.message); return; }
    sendStepRefused(res, step, e, `replacement live call failed: ${e.message}`);
  } finally {
    close();
  }
}

async function handleRouting(req, res) {
  const step = 'routing';
  let close = () => {};
  try {
    const body = await readJsonBody(req);
    const { workspace, stepInput } = workspaceAndInput(body);
    // Routing calls qloo_where_popular directly (no runVerdict key gate),
    // so the key gate is explicit here: unconfigured Qloo refuses closed
    // instead of surfacing a transport spawn error.
    if (!config.qlooKeyConfigured) throw notConfigured();
    const visitorIp = visitorIpFor(req);
    const built = await buildDeps({ isCancelled: () => req.socket?.destroyed === true });
    close = built.close;
    const out = await runRouting(workspace, stepInput, built.deps, { visitorIp });
    send(res, 200, out);
  } catch (e) {
    if (e.cancelled) return;
    if (e instanceof OfferError) { sendStepRefused(res, step, e, e.message); return; }
    sendStepRefused(res, step, e, `routing live call failed: ${e.message}`);
  } finally {
    close();
  }
}

async function handleComparison(req, res) {
  const step = 'comparison';
  let closeAll = () => {};
  try {
    const body = await readJsonBody(req);
    const { workspace, stepInput } = workspaceAndInput(body);
    const visitorIp = visitorIpFor(req);
    const sessions = [];
    closeAll = () => { for (const c of sessions) { try { c(); } catch { /* already closed */ } } };
    const makeDeps = async () => {
      const built = await buildDeps({ isCancelled: () => req.socket?.destroyed === true });
      sessions.push(built.close);
      return built;
    };
    const out = await runComparison(workspace, stepInput, makeDeps, {
      checkVisitor: (ip) => guards.checkVisitor(ip),
      visitorIp,
      isCancelled: () => req.socket?.destroyed === true,
    });
    send(res, 200, out);
  } catch (e) {
    if (e.cancelled) return;
    if (e instanceof OfferError) { sendStepRefused(res, step, e, e.message); return; }
    sendStepRefused(res, step, e, `comparison live call failed: ${e.message}`);
  } finally {
    closeAll();
  }
}

// POST /api/verdict/rerank (Phase 3, Wave 2, item I): opener re-rank with
// exclusion. The client sends the verdict's own candidate/ranked sets
// plus the top pick to exclude; the server re-runs ONLY the qloo_rank leg
// with the same candidate set minus that pick. The original verdict is
// never touched — this endpoint returns a separate result, and the
// frontend renders it as a separate section. Guarded like a verdict leg
// (key gate, per-visitor cap, call budget); a keyless backend refuses
// 503 NOT_CONFIGURED with the exact label, and the frontend renders that
// label with no number from the failed run. An ok-but-empty rank
// envelope refuses 502 RERANK_EMPTY, never an invented pick.
async function handleRerank(req, res) {
  let close = () => {};
  try {
    const body = await readJsonBody(req);
    const artist = typeof body.artist === 'string' ? body.artist.trim() : '';
    const city = typeof body.city === 'string' ? body.city.trim() : '';
    if (!artist) throw invalidInput('artist is required');
    if (!city) throw invalidInput('city is required');
    if (!Array.isArray(body.candidates) && !Array.isArray(body.ranked)) {
      throw invalidInput('candidates or ranked must be an array');
    }
    if (body.excludedPick === undefined || body.excludedPick === null || body.excludedPick === '') {
      throw invalidInput('excludedPick is required');
    }
    if (!config.qlooKeyConfigured) throw notConfigured();
    const visitorIp = visitorIpFor(req);
    guards.resetRun();
    guards.checkVisitor(visitorIp);
    guards.checkCall();
    const built = await buildDeps({ isCancelled: () => req.socket?.destroyed === true });
    close = built.close;
    let args;
    try {
      args = buildRerankArgs({
        artist,
        city,
        candidates: body.candidates || [],
        ranked: body.ranked || [],
        excludedPick: body.excludedPick,
        headlinerId: typeof body.headlinerId === 'string' ? body.headlinerId : null,
      });
    } catch (e) {
      throw invalidInput(e.message);
    }
    // `remaining` is the server-side candidate list for display only — it
    // is never sent as a rank argument; only the rank-leg shape goes out.
    const { remaining: _remaining, ...rankArgs } = args;
    const envelope = await built.deps.mcpCall('qloo_rank', rankArgs);
    const results = Array.isArray(envelope?.results) ? envelope.results : [];
    const receipt = (envelope?.status === 'ok' && results.length > 0)
      ? {
          claim: 'opener shortlist re-ranked without the top pick',
          operation: 'qloo_rank',
          hashKind: 'args',
          requestHash: argsHashFor('qloo_rank', rankArgs),
          requestId: envelope?.requestId ?? null,
          resultCount: envelope?.result_count ?? results.length,
          replay: { kind: 'mcp', tool: 'qloo_rank', args: rankArgs },
        }
      : null;
    const out = formatRerankResult(envelope, { excludedPick: body.excludedPick, receipt });
    if (out.status !== 'ok') {
      throw new OfferError('RERANK_EMPTY', 502, `Re-rank returned no pick: ${out.label}. No new pick is shown from this run.`);
    }
    send(res, 200, out);
  } catch (e) {
    if (e instanceof OfferError) { sendError(res, e); return; }
    sendError(res, new OfferError('QLOO_ERROR', 502, `Re-rank failed: ${e.message}`));
  } finally {
    close();
  }
}

// POST /api/workspace/geocode: display-only geography for the routing map
// strip. Takes { cities: [base city, ...routing candidate cities] } and
// returns { pins, failures }. No workspace verification: the input is
// public city names and the output is public coordinates — no keys, no
// user data, nothing stored. Pins never feed ranking or break-even; the
// routing table stays authoritative. Nominatim serialization (1 req/s)
// bounds the batch cost; a failed lookup omits that city, never places it.
async function handleGeocode(req, res) {
  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidInput('cities must be an array of 1–11 city strings');
  }
  const out = await geocodeCities(body.cities, { baseUrl: config.osmBaseUrl });
  send(res, 200, out);
}

// GET /api/verdict/stream (SSE): same inputs as POST /api/verdict via
// query params. Each emitted `leg` event corresponds to one real completed
// dependency call (tool/path + status + elapsed ms) — never a staged label.
// The final `verdict` event is the full verdict object; an OfferError
// becomes an `error` event, then the stream ends. A client disconnect
// sets the cancelled flag, so the run ends withheld, never partial.
async function handleVerdictStream(req, res, url) {
  const q = url.searchParams;
  const num = (v) => (v === null || v === '' ? undefined : Number(v));
  const input = {
    artist: q.get('artist') ?? '',
    city: q.get('city') ?? '',
    guarantee: num(q.get('guarantee')),
    ticketPrice: num(q.get('ticketPrice')),
    variableCost: num(q.get('variableCost')),
    capacity: num(q.get('capacity')),
    venue: q.get('venue') ?? undefined,
    entityHint: q.get('entityHint') ?? undefined,
    visitorIp: visitorIpFor(req),
  };
  // Socket-destroyed, NOT req 'close': the request stream's 'close'
  // fires as soon as the body is consumed (proven in testing), which
  // would cancel every run before its first leg. A destroyed socket is
  // the real disconnect signal.
  const cancelled = () => req.socket?.destroyed === true;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const emit = (event, data) => {
    try {
      if (!res.writableEnded && !cancelled()) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch { /* client gone */ }
  };
  const timed = (callName, fn, statusOf) => async (...args) => {
    const t0 = Date.now();
    try {
      const out = await fn(...args);
      emit('leg', { call: callName, status: statusOf(out), elapsedMs: Date.now() - t0 });
      return out;
    } catch (e) {
      emit('leg', { call: callName, status: 'error', elapsedMs: Date.now() - t0 });
      throw e;
    }
  };
  let close = () => {};
  try {
    const gutArm = timed('gutArm', ({ question }) => runGutArm({ question }), (o) => o?.status ?? 'error');
    const webArm = timed('webArm', ({ question, webFacts }) => runWebArm({ question, webFacts }), (o) => o?.status ?? 'error');
    const built = await buildDeps({ gutArm, webArm, isCancelled: cancelled });
    close = built.close;
    const deps = built.deps;
    const mcpCall = async (tool, args) => {
      const t0 = Date.now();
      try {
        const env = await deps.mcpCall(tool, args);
        emit('leg', { call: tool, tool, status: env?.status ?? 'error', elapsedMs: Date.now() - t0 });
        return env;
      } catch (e) {
        emit('leg', { call: tool, tool, status: 'error', elapsedMs: Date.now() - t0 });
        throw e;
      }
    };
    const restCall = async ({ path, params }) => {
      const t0 = Date.now();
      try {
        const out = await deps.restCall({ path, params });
        // T3: transport-ok is not leg-ok. A 2xx with an empty list and no
        // payload becomes leg status 'empty' in the pipeline (restLeg), so
        // the streamed line must say 'empty' too — otherwise the progress
        // list showed 'ok' for a leg the verdict card then shows as empty.
        // The test mirrors restLeg exactly: empty list + null/0 count +
        // no payload => 'empty'; anything else on a 2xx => 'ok'.
        const entities = Array.isArray(out?.entities) ? out.entities : [];
        const count = out?.resultCount ?? entities.length;
        const restStatus = !out?.ok ? 'error'
          : (entities.length === 0 && (count === null || count === 0) && !out?.payloadPresent ? 'empty' : 'ok');
        emit('leg', { call: `rest:${path}`, path, status: restStatus, elapsedMs: Date.now() - t0 });
        return out;
      } catch (e) {
        emit('leg', { call: `rest:${path}`, path, status: 'error', elapsedMs: Date.now() - t0 });
        throw e;
      }
    };
    const streamDeps = {
      ...deps,
      mcpCall,
      restCall,
      tmEvents: timed('tmEvents', deps.tmEvents, (o) => (o?.ok ? 'ok' : 'error')),
      tmVenues: timed('tmVenues', deps.tmVenues, (o) => (o?.ok ? 'ok' : 'error')),
      geocodeFn: timed('geocode', deps.geocodeFn, (o) => (o?.ok ? 'ok' : 'error')),
      wikidataFn: timed('wikidata', deps.wikidataFn, (o) => (o?.ok ? 'ok' : 'error')),
    };
    const verdict = await runVerdict(input, streamDeps);
    if (!cancelled()) emit('verdict', verdict);
  } catch (e) {
    if (!cancelled()) {
      emit('error', e instanceof OfferError
        ? { code: e.code, message: e.message }
        : { code: 'INTERNAL', message: 'Internal error' });
    }
  } finally {
    close();
    try { res.end(); } catch { /* already closed */ }
  }
}

async function handleBench(res) {
  try {
    const text = await readFile(BENCH_FILE, 'utf8');
    send(res, 200, JSON.parse(text), 'application/json; charset=utf-8');
  } catch {
    send(res, 200, {
      runs: [],
      note: 'No benchmark runs recorded yet — runs require a live Qloo key and real trials, and are never fabricated.',
    });
  }
}

async function handleStatic(req, res) {
  let rel = req.url === '/' ? 'index.html' : req.url.split('?')[0].slice(1);
  const safe = normalize(join(FRONTEND_DIR, rel));
  if (!safe.startsWith(FRONTEND_DIR)) {
    send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    return;
  }
  try {
    const data = await readFile(safe);
    // Send the raw bytes: decoding binary assets (webp/png) as UTF-8 corrupts them.
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(safe)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
  }
}

const server = http.createServer(async (req, res) => {
  // URL-parse guard (pre-existing robustness quirk): `new URL` throws on
  // malformed request targets (e.g. a bare `//`), and the throw used to sit
  // outside the try below — an uncaught throw that crashed the whole
  // process. A malformed path now returns a clean 400 instead.
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    send(res, 400, { error: { code: 'BAD_REQUEST', message: 'Malformed request path' } });
    return;
  }
  const path = url.pathname;
  try {
    if (req.method === 'GET' && path === '/api/health') {
      // G10/G18: health exposes ONLY the configured booleans the frontend
      // reads (qlooConfigured). No hardcoded tool count, no guard counts —
      // counts are tripwire internals, not a public signal.
      send(res, 200, {
        status: 'ok',
        version: '0.1.0',
        qlooConfigured: config.qlooKeyConfigured,
        ticketmasterConfigured: config.tmKeyConfigured,
        llmConfigured: llmConfigured(),
      });
    } else if (req.method === 'POST' && path === '/api/verdict') {
      await handleVerdict(req, res);
    } else if (req.method === 'POST' && path === '/api/race') {
      await handleVerdict(req, res, { race: true });
    } else if (req.method === 'POST' && path === '/api/replay') {
      await handleReplay(req, res);
    } else if (req.method === 'POST' && path === '/api/verdict/rerank') {
      await handleRerank(req, res);
    } else if (req.method === 'POST' && path === '/api/workspace/verify') {
      await handleWorkspaceVerify(req, res);
    } else if (req.method === 'POST' && path === '/api/workspace/replacement') {
      await handleReplacement(req, res);
    } else if (req.method === 'POST' && path === '/api/workspace/renegotiate') {
      await handlePureWorkspaceStep(req, res, 'renegotiation', computeRenegotiation);
    } else if (req.method === 'POST' && path === '/api/workspace/route') {
      await handleRouting(req, res);
    } else if (req.method === 'POST' && path === '/api/workspace/envelope') {
      await handlePureWorkspaceStep(req, res, 'envelope', computeEnvelope);
    } else if (req.method === 'POST' && path === '/api/workspace/compare') {
      await handleComparison(req, res);
    } else if (req.method === 'POST' && path === '/api/workspace/geocode') {
      await handleGeocode(req, res);
    } else if (req.method === 'POST' && path === '/api/workspace/settle') {
      await handlePureWorkspaceStep(req, res, 'settlement', computeSettlement);
    } else if (req.method === 'GET' && path === '/api/verdict/stream') {
      await handleVerdictStream(req, res, url);
    } else if (req.method === 'GET' && path === '/api/bench') {
      await handleBench(res);
    } else if (req.method === 'GET') {
      await handleStatic(req, res);
    } else {
      send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    console.log(`${req.method} ${path} ${res.statusCode}`);
  } catch (e) {
    try {
      sendError(res, e);
      console.log(`${req.method} ${path} ${res.statusCode}`);
    } catch {
      // response already closed
    }
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`OfferSheet listening on port ${config.port}`);
});
