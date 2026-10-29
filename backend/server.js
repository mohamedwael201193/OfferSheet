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
import { McpSession } from './src/mcp.js';
import { qlooRest } from './src/rest.js';
import { searchEvents } from './src/ticketmaster.js';
import { geocode } from './src/osm.js';
import { searchEntities } from './src/wikidata.js';
import { runGutArm, runWebArm, llmConfigured } from './src/arms.js';
import { runVerdict } from './src/pipeline.js';
import { OfferError, notConfigured } from './src/errors.js';

const FRONTEND_DIR = fileURLToPath(new URL('../frontend/', import.meta.url));
const BENCH_FILE = fileURLToPath(new URL('../../bench/results.json', import.meta.url));
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

async function buildDeps({ gutArm, webArm } = {}) {
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
      mcpCall,
      restCall: ({ path, params }) => qlooRest({
        path, params, key: config.qlooKey, baseUrl: config.qlooBaseUrl, timeoutMs: config.restTimeoutMs,
      }),
      tmEvents: ({ keyword, city }) => searchEvents({
        keyword, city, key: config.ticketmasterKey, baseUrl: config.ticketmasterBaseUrl,
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
  const { deps, close } = await buildDeps({ gutArm, webArm });
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

async function handleReplay(req, res) {
  const body = await readJsonBody(req);
  if (!config.qlooKeyConfigured) throw notConfigured();
  if (body.kind === 'mcp' && typeof body.tool === 'string') {
    const session = new McpSession({
      command: config.qlooMcpCommand,
      args: ['mcp'],
      timeoutMs: config.mcpTimeoutMs,
    });
    try {
      await session.start();
      const envelope = await session.call(body.tool, body.args || {});
      send(res, 200, { kind: 'mcp', tool: body.tool, envelope });
    } finally {
      session.close();
    }
    return;
  }
  if (body.kind === 'rest' && typeof body.path === 'string') {
    const result = await qlooRest({
      path: body.path,
      params: body.params || {},
      key: config.qlooKey,
      baseUrl: config.qlooBaseUrl,
      timeoutMs: config.restTimeoutMs,
    });
    send(res, 200, { kind: 'rest', path: body.path, result });
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
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  try {
    if (req.method === 'GET' && path === '/api/health') {
      send(res, 200, {
        status: 'ok',
        version: '0.1.0',
        tools: 10,
        qlooConfigured: config.qlooKeyConfigured,
        ticketmasterConfigured: config.tmKeyConfigured,
        llmConfigured: llmConfigured(),
        guards: guards.snapshot(),
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
