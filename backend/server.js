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
import { Guards } from './src/guards.js';
import { ReceiptStore } from './src/receipts.js';
import { McpSession, MCP_TOOLS } from './src/mcp.js';
import { qlooRest, REST_PATHS } from './src/rest.js';
import { searchEvents, searchVenues } from './src/ticketmaster.js';
import { geocode } from './src/osm.js';
import { searchEntities } from './src/wikidata.js';
import { runGutArm, runWebArm, llmConfigured } from './src/arms.js';
import { runVerdict } from './src/pipeline.js';
import { OfferError, notConfigured } from './src/errors.js';

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
  const visitorIp = req.socket?.remoteAddress || 'unknown';
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
  const visitorIp = req.socket?.remoteAddress || 'unknown';
  if (body.kind === 'mcp' && typeof body.tool === 'string') {
    if (!MCP_TOOLS.includes(body.tool)) {
      throw new OfferError('INVALID_INPUT', 400, `Replay tool not allowlisted: ${body.tool}`);
    }
    if (body.args !== undefined && (typeof body.args !== 'object' || body.args === null || Array.isArray(body.args))) {
      throw new OfferError('INVALID_INPUT', 400, 'Replay MCP args must be an object');
    }
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
      send(res, 200, {
        kind: 'mcp',
        tool: body.tool,
        envelope,
        // Both names: the replay comparator reads `ids` first, `entityIds` second.
        ids: orderedEntityIds(results),
        entityIds: orderedEntityIds(results),
        resultCount: envelope?.result_count ?? results.length,
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
      // Both names: the replay comparator reads `ids` first, `entityIds` second.
      ids: orderedEntityIds(result.entities),
      entityIds: orderedEntityIds(result.entities),
      resultCount: result.resultCount,
    });
    return;
  }
  throw new OfferError('INVALID_INPUT', 400, 'Replay requires kind mcp (tool + args) or kind rest (path + params)');
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
