// OfferSheet MCP server — stdio NDJSON JSON-RPC 2.0, protocol 2024-11-05.
// Zero-dependency Node (node: built-ins only), ESM. Thin adapter only: every
// tool reuses backend/src code by import — pipeline, REST, receipts, guards,
// arms, break-even, Ticketmaster, OSM, Wikidata, and the MCP allowlists.
// Zero disk writes: this file reads three repo files (receipts manifest,
// bench ledger, trial pack) and never writes any file. Restart clears the
// guard counters and the session receipt store — see tool 31's response and
// the startup diagnostic on stderr. Stderr carries diagnostics only
// (method / tool / status), never bodies, URLs with query strings, headers,
// artist strings, or keys. Keys come from the host environment only, never
// from a tool argument: the Qloo harness subprocess inherits process.env.
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { config as prodConfig } from './src/config.js';
import { Guards } from './src/guards.js';
import { ReceiptStore, argsHashFor, requestHashFor, sha256 } from './src/receipts.js';
import { OfferError, notConfigured, invalidInput } from './src/errors.js';
import { McpSession, MCP_TOOLS } from './src/mcp.js';
import { qlooRest, REST_PATHS } from './src/rest.js';
import { searchEvents, searchVenues, extractCapacity, extractPrice, extractFirstVenue, extractFirstVenueResult } from './src/ticketmaster.js';
import { geocode } from './src/osm.js';
import { searchEntities } from './src/wikidata.js';
import { runGutArm, runWebArm, llmConfigured } from './src/arms.js';
import { buildMissTrial } from './src/arms.js';
import { breakEven } from './src/breakeven.js';
import { runVerdict } from './src/pipeline.js';
import { buildRerankArgs, formatRerankResult } from './src/rerank.js';

export const PROTOCOL_VERSION = '2024-11-05';
export const SERVER_NAME = 'offersheet';
export const SERVER_VERSION = '0.1.0';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function diag(method, tool, status) {
  try {
    process.stderr.write(`[mcp] ${JSON.stringify({ method, tool: tool ?? null, status })}\n`);
  } catch { /* diagnostics never break a call */ }
}

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
function orderedEntityIds(items) {
  if (!Array.isArray(items)) return [];
  return items.map((it) => (it && typeof it === 'object' ? (it.entity_id ?? it.id ?? it.uuid ?? null) : null)).filter((id) => id !== null);
}
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ---- schema validation -------------------------------------------------
// inputSchema is JSON Schema (type/properties/required/additionalProperties).
// Each property definition may also carry validator-only hints (min,
// integer, itemsType, urn) which are stripped from the wire schema.
function wireSchema(def) {
  const properties = {};
  for (const [k, p] of Object.entries(def)) {
    const out = { type: p.type };
    if (p.type === 'array' && p.itemsType) out.items = { type: p.itemsType };
    if (p.type === 'number' && p.min !== undefined) out.minimum = p.min;
    if (p.type === 'number' && p.gt !== undefined) out.exclusiveMinimum = p.gt;
    if (p.enum) out.enum = p.enum;
    if (p.description) out.description = p.description;
    properties[k] = out;
  }
  return properties;
}

function validateArgs(toolName, def, args) {
  if (!isPlainObject(args)) throw invalidInput(`Tool ${toolName} arguments must be an object`);
  for (const key of Object.keys(args)) {
    if (!(key in def)) throw invalidInput(`Unknown argument for ${toolName}: ${key}`);
  }
  for (const [key, p] of Object.entries(def)) {
    const v = args[key];
    if (v === undefined) {
      if (p.required) throw invalidInput(`Missing required argument for ${toolName}: ${key}`);
      continue;
    }
    if (p.type === 'string') {
      if (typeof v !== 'string') throw invalidInput(`Argument ${key} for ${toolName} must be a string`);
      if (p.required && v.trim().length === 0) throw invalidInput(`Argument ${key} for ${toolName} must not be empty`);
      if (p.urn && !v.startsWith('urn:')) throw invalidInput(`Argument ${key} for ${toolName} must be a urn: string`);
    } else if (p.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw invalidInput(`Argument ${key} for ${toolName} must be a number`);
      if (p.min !== undefined && v < p.min) throw invalidInput(`Argument ${key} for ${toolName} must be >= ${p.min}`);
      if (p.gt !== undefined && v <= p.gt) throw invalidInput(`Argument ${key} for ${toolName} must be > ${p.gt}`);
      if (p.integer && !Number.isInteger(v)) throw invalidInput(`Argument ${key} for ${toolName} must be an integer`);
    } else if (p.type === 'array') {
      if (!Array.isArray(v)) throw invalidInput(`Argument ${key} for ${toolName} must be an array`);
      if (p.required && v.length === 0) throw invalidInput(`Argument ${key} for ${toolName} must not be empty`);
      if (p.itemsType === 'string') {
        for (const el of v) if (typeof el !== 'string') throw invalidInput(`Argument ${key} for ${toolName} must contain only strings`);
        if (p.urn) for (const el of v) if (!el.startsWith('urn:')) throw invalidInput(`Argument ${key} for ${toolName} must contain only urn: strings`);
      }
    } else if (p.type === 'object') {
      if (!isPlainObject(v)) throw invalidInput(`Argument ${key} for ${toolName} must be an object`);
    } else if (p.type === 'boolean') {
      if (typeof v !== 'boolean') throw invalidInput(`Argument ${key} for ${toolName} must be a boolean`);
    }
    if (p.enum && !p.enum.includes(v)) throw invalidInput(`Argument ${key} for ${toolName} must be one of: ${p.enum.join(', ')}`);
  }
}

function errPayload(e) {
  if (e instanceof OfferError) return { code: e.code, message: e.message };
  return { code: 'QLOO_ERROR', message: e?.message ? String(e.message) : 'Upstream call failed' };
}

// Canonical sorted-key stringify, as used by the trial-pack check.
function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}

// ---- app factory ---------------------------------------------------------
// Production calls createMcpApp() with no arguments: it wires the live
// transports exactly as backend/server.js buildDeps does. Tests pass a deps
// object with injected transports (the same dependency-injection seam the
// pipeline uses); production code never imports a test file.
export function createMcpApp(deps = {}) {
  const cfg = { ...prodConfig, ...(deps.config || {}) };
  const guards = deps.guards || new Guards({
    monthlyBudget: cfg.monthlyCallBudget,
    perVisitorDailyCap: cfg.perVisitorDailyCap,
    perRunCallCap: cfg.perRunCallCap,
  });
  const receipts = deps.receipts || new ReceiptStore();
  const manifestPath = deps.manifestPath || join(ROOT, 'receipts.json');
  const benchPath = deps.benchPath || join(ROOT, 'bench', 'results.json');
  const defaultPackPath = deps.packPath || join(ROOT, 'frontend', 'trial-pack.json');
  const llmConfiguredValue = deps.llmConfigured !== undefined ? deps.llmConfigured : null;
  const fetchImpl = deps.fetchImpl || fetch;

  // Lazily-started harness session (started on first Qloo-dependent call,
  // never at boot, so a keyless server still answers tools/list and the
  // offline/read tools). If the harness exits, the next call re-spawns it.
  let session = null;
  const sessionFactory = deps.mcpSessionFactory || (() => new McpSession({
    command: cfg.qlooMcpCommand || 'qloo',
    args: ['mcp'],
    timeoutMs: cfg.mcpTimeoutMs || 60000,
    ...(deps.spawnFn ? { spawnFn: deps.spawnFn } : {}),
  }));
  async function ensureSession() {
    if (session && session.started) return session;
    session = sessionFactory();
    try {
      await session.start();
    } catch (e) {
      session = null;
      throw new OfferError('QLOO_ERROR', 502, `Qloo harness unavailable: ${e.message}`);
    }
    return session;
  }
  async function mcpCall(tool, args) {
    if (typeof deps.mcpCall === 'function') return deps.mcpCall(tool, args);
    const s = await ensureSession();
    try {
      return await s.call(tool, args);
    } catch (e) {
      if (e instanceof OfferError) throw e;
      if (/exited|spawn|timed out/i.test(e.message || '')) {
        try { s.close(); } catch { /* already gone */ }
        session = null;
      }
      throw e;
    }
  }
  async function restFn({ path, params }) {
    if (typeof deps.restCall === 'function') return deps.restCall({ path, params });
    return qlooRest({ path, params, key: cfg.qlooKey, baseUrl: cfg.qlooBaseUrl, timeoutMs: cfg.restTimeoutMs || 25000, fetchImpl });
  }
  async function tmEventsFn(arg) {
    if (typeof deps.tmEvents === 'function') return deps.tmEvents(arg);
    return searchEvents({ ...arg, key: cfg.ticketmasterKey, baseUrl: cfg.ticketmasterBaseUrl, fetchImpl });
  }
  async function tmVenuesFn(arg) {
    if (typeof deps.tmVenues === 'function') return deps.tmVenues(arg);
    return searchVenues({ ...arg, key: cfg.ticketmasterKey, baseUrl: cfg.ticketmasterBaseUrl, fetchImpl });
  }
  async function geocodeFn(arg) {
    if (typeof deps.geocodeFn === 'function') return deps.geocodeFn(arg);
    return geocode({ ...arg, baseUrl: cfg.osmBaseUrl, fetchImpl });
  }
  async function wikidataFn(arg) {
    if (typeof deps.wikidataFn === 'function') return deps.wikidataFn(arg);
    return searchEntities({ ...arg, baseUrl: cfg.wikidataBaseUrl, fetchImpl, limit: arg.limit ?? 5 });
  }
  async function gutArmFn(arg) {
    if (typeof deps.gutArm === 'function') return deps.gutArm(arg);
    return runGutArm({ ...arg, fetchImpl });
  }
  async function webArmFn(arg) {
    if (typeof deps.webArm === 'function') return deps.webArm(arg);
    return runWebArm({ ...arg, fetchImpl });
  }
  function llmOk() {
    return llmConfiguredValue !== null ? llmConfiguredValue : llmConfigured();
  }

  function recordMcp(claim, tool, args, env) {
    const results = Array.isArray(env?.results) ? env.results : [];
    const ids = results.map(itemId).filter((id) => id !== null && id !== undefined);
    return receipts.add({
      claim,
      operation: tool,
      hashKind: 'args',
      requestHash: argsHashFor(tool, args),
      requestId: env?.requestId ?? env?.request_id ?? null,
      resultCount: env?.result_count ?? results.length,
      ...(ids.length > 0 ? { ids, entityIds: ids } : {}),
      replay: { kind: 'mcp', tool, args },
    });
  }
  function recordRest(claim, path, params, out) {
    const entities = Array.isArray(out?.entities) ? out.entities : [];
    const ids = entities.map((e) => e.id ?? null).filter((id) => id !== null);
    return receipts.add({
      claim,
      operation: `rest:${path}`,
      hashKind: 'url',
      requestHash: out?.requestHash ?? null,
      requestId: out?.requestId ?? null,
      resultCount: out?.resultCount ?? entities.length,
      ...(ids.length > 0 ? { ids, entityIds: ids } : {}),
      replay: { kind: 'rest', path, params },
    });
  }
  // Guarded proxy step shared by tools 3-12: allowlist is structural (the
  // tool name itself is one of MCP_TOOLS), then guard, then call, then receipt.
  async function proxy(tool, args, claim) {
    if (!MCP_TOOLS.includes(tool)) throw invalidInput(`Tool not allowlisted: ${tool}`);
    if (!cfg.qlooKeyConfigured) throw notConfigured();
    guards.checkCall();
    const env = await mcpCall(tool, args);
    const receipt = recordMcp(claim, tool, args, env);
    return { status: env?.status ?? 'ok', envelope: env, receipt };
  }
  async function restTool(path, params, claim) {
    if (!REST_PATHS.includes(path)) throw invalidInput(`REST path not allowlisted: ${path}`);
    if (!cfg.qlooKeyConfigured) throw notConfigured();
    guards.checkCall();
    const out = await restFn({ path, params });
    if (!out || !out.ok) {
      throw new OfferError('QLOO_ERROR', 502, `Qloo REST returned ${out?.status ?? 'unknown'}`);
    }
    const entities = Array.isArray(out.entities) ? out.entities : [];
    const empty = entities.length === 0 && (out.resultCount === null || out.resultCount === 0 || out.resultCount === undefined) && !out.payloadPresent;
    let receipt = null;
    if (!empty) receipt = recordRest(claim, path, params, out);
    return {
      status: empty ? 'empty' : 'ok',
      ...(empty ? { reason: 'no data for this entity/region' } : {}),
      result: out,
      entities,
      resultCount: out.resultCount ?? entities.length,
      receipt,
    };
  }
  function verdictDeps(overrides = {}) {
    return {
      config: cfg,
      guards,
      receipts,
      checkCall: () => guards.checkCall(),
      mcpCall,
      restCall: ({ path, params }) => restFn({ path, params }),
      tmEvents: tmEventsFn,
      tmVenues: tmVenuesFn,
      geocodeFn,
      wikidataFn,
      gutArm: gutArmFn,
      webArm: webArmFn,
      verdictBudgetMs: cfg.verdictBudgetMs || 90000,
      ...overrides,
    };
  }

  // ---- tool handlers -----------------------------------------------------
  const handlers = {
    async offersheet_verdict_run(a) {
      const v = await runVerdict(a, verdictDeps());
      return { ...v, quotaSpent: true };
    },
    async offersheet_verdict_race(a) {
      let gutMs = null;
      let webMs = null;
      const timed = (fn, set) => async (arg) => {
        const t0 = Date.now();
        const out = await fn(arg);
        set(Date.now() - t0);
        return out;
      };
      const v = await runVerdict(a, verdictDeps({
        gutArm: timed(gutArmFn, (ms) => { gutMs = ms; }),
        webArm: timed(webArmFn, (ms) => { webMs = ms; }),
      }));
      return { ...v, race: { gutMs, webMs, totalMs: v.timingMs ?? null }, quotaSpent: true };
    },
    async qloo_capabilities(a) {
      const args = a.operation_ids ? { operation_ids: a.operation_ids } : {};
      return { ...(await proxy('qloo_capabilities', args, 'Qloo capabilities')), quotaSpent: true };
    },
    async qloo_find_tags(a) {
      return { ...(await proxy('qloo_find_tags', a, 'headliner tags')), quotaSpent: true };
    },
    async qloo_describe(a) {
      const args = { entity: a.entity, type: a.type || 'artist' };
      const out = await proxy('qloo_describe', args, 'entity description');
      if (out.envelope?.status === 'needs_input') {
        return { status: 'needs_input', candidates: namesOf(out.envelope.results), envelope: out.envelope, receipt: out.receipt, quotaSpent: true };
      }
      return { ...out, quotaSpent: true };
    },
    async qloo_recommend(a) {
      return { ...(await proxy('qloo_recommend', a, 'opener candidates')), quotaSpent: true };
    },
    async qloo_rank(a) {
      return { ...(await proxy('qloo_rank', a, 'opener ranking')), quotaSpent: true };
    },
    async qloo_where_popular(a) {
      const out = await proxy('qloo_where_popular', a, 'where popular');
      return { ...out, note: 'Matched areas/entities only — Qloo returns no headcount, and none is claimed here.', quotaSpent: true };
    },
    async qloo_audience_demographics(a) {
      return { ...(await proxy('qloo_audience_demographics', a, 'audience demographic bands')), quotaSpent: true };
    },
    async qloo_entity_tags(a) {
      return { ...(await proxy('qloo_entity_tags', a, 'entity tags')), quotaSpent: true };
    },
    async qloo_trends(a) {
      return { ...(await proxy('qloo_trends', a, 'entity trends')), quotaSpent: true };
    },
    async qloo_compare_audiences(a) {
      return { ...(await proxy('qloo_compare_audiences', a, 'audience comparison')), quotaSpent: true };
    },
    async offersheet_rest_search(a) {
      return { ...(await restTool('/search', { query: a.query, take: a.take ?? 5 }, 'REST name resolution')), quotaSpent: true };
    },
    async offersheet_rest_insights_by_tags(a) {
      return { ...(await restTool('/v2/insights', { 'filter.type': a.filterType || 'urn:entity:artist', 'signal.interests.tags': a.tagUrns.join(','), 'feature.explainability': 'true' }, 'REST insights by tags')), quotaSpent: true };
    },
    async offersheet_rest_compare(a) {
      return { ...(await restTool('/v2/analysis/compare', { 'a.signal.interests.entities': a.aIds.join(','), 'b.signal.interests.entities': a.bIds.join(',') }, 'REST audience comparison')), quotaSpent: true };
    },
    async offersheet_rest_entities(a) {
      const slice = a.ids.slice(0, 15);
      const out = await restTool('/entities', { entity_ids: slice.join(',') }, 'REST entity hydration');
      return { ...out, idsSent: slice.length, idsRequested: a.ids.length, quotaSpent: true };
    },
    async offersheet_receipt_replay(a) {
      // Key gate precedes ALL validation here, exactly as handleReplay does:
      // a keyless bogus replay fails closed, never replays.
      if (!cfg.qlooKeyConfigured) throw notConfigured();
      if (a.kind === 'mcp') {
        if (typeof a.tool !== 'string' || !MCP_TOOLS.includes(a.tool)) throw invalidInput(`Replay tool not allowlisted: ${a.tool}`);
        if (a.args !== undefined && !isPlainObject(a.args)) throw invalidInput('Replay MCP args must be an object');
        guards.checkCall();
        const envelope = await mcpCall(a.tool, a.args || {});
        const ids = orderedEntityIds(envelope?.results);
        return { kind: 'mcp', tool: a.tool, envelope, ids, entityIds: ids, resultCount: envelope?.result_count ?? ids.length, comparison: compareIds(ids, a.originalIds), quotaSpent: true };
      }
      if (a.kind === 'rest') {
        if (typeof a.path !== 'string' || !a.path.startsWith('/') || a.path.includes('://') || a.path.startsWith('//')) throw invalidInput('Replay REST paths must be relative paths');
        if (!REST_PATHS.includes(a.path)) throw invalidInput(`Replay REST path not allowlisted: ${a.path}`);
        if (a.params !== undefined && !isPlainObject(a.params)) throw invalidInput('Replay REST params must be an object');
        guards.checkCall();
        const result = await restFn({ path: a.path, params: a.params || {} });
        const ids = orderedEntityIds(result?.entities);
        return { kind: 'rest', path: a.path, result, ids, entityIds: ids, resultCount: result?.resultCount ?? ids.length, comparison: compareIds(ids, a.originalIds), quotaSpent: true };
      }
      throw invalidInput('Replay requires kind mcp (tool + args) or kind rest (path + params)');
    },
    async offersheet_receipt_verify_hash(a) {
      if (a.tool !== undefined) {
        if (typeof a.tool !== 'string') throw invalidInput('tool must be a string');
        const recomputed = argsHashFor(a.tool, a.args || {});
        return { status: 'ok', valid: recomputed === a.requestHash, recomputedHash: recomputed, requestHash: a.requestHash, operation: a.operation, hashKind: 'args', quotaSpent: false };
      }
      if (a.method !== undefined && a.url !== undefined) {
        const recomputed = requestHashFor(a.method, a.url);
        return { status: 'ok', valid: recomputed === a.requestHash, recomputedHash: recomputed, requestHash: a.requestHash, operation: a.operation, hashKind: 'url', quotaSpent: false };
      }
      throw invalidInput('Hash verification requires tool + args (MCP receipt) or method + url (REST receipt)');
    },
    async offersheet_receipts_list(a) {
      const source = a.source || 'session';
      if (source === 'session') {
        let list = receipts.all();
        if (a.id !== undefined) list = list.filter((r) => r.id === a.id);
        if (a.requestHash !== undefined) list = list.filter((r) => r.requestHash === a.requestHash);
        if (a.operation !== undefined) list = list.filter((r) => r.operation === a.operation);
        return { status: 'ok', source: 'session', receipts: list, note: 'Session receipts only: this server process only. Restart clears this store.', quotaSpent: false };
      }
      let parsed;
      try {
        parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
      } catch {
        return { status: 'ok', source: 'manifest', manifest: [], receipts: [], note: 'No receipts manifest recorded yet.', quotaSpent: false };
      }
      let list = Array.isArray(parsed.manifest) ? parsed.manifest : [];
      if (a.id !== undefined) list = list.filter((r) => r.id === a.id);
      if (a.requestHash !== undefined) list = list.filter((r) => r.requestHash === a.requestHash);
      if (a.operation !== undefined) list = list.filter((r) => r.operation === a.operation);
      return { status: 'ok', source: 'manifest', version: parsed.version ?? null, manifest: list, receipts: list, note: parsed.note ?? null, quotaSpent: false };
    },
    async offersheet_trials_list(a) {
      let parsed;
      try {
        parsed = JSON.parse(await readFile(benchPath, 'utf8'));
      } catch {
        return { status: 'ok', label: 'recorded, not live', runs: [], note: 'No benchmark runs recorded yet — runs require a live Qloo key and real trials, and are never fabricated.', quotaSpent: false };
      }
      const runs = Array.isArray(parsed.runs) ? parsed.runs : [];
      if (a.index !== undefined) {
        if (!Number.isInteger(a.index) || a.index < 0 || a.index >= runs.length) throw invalidInput(`Trial index out of range: ${a.index}`);
        return { status: 'ok', label: 'recorded, not live', run: runs[a.index], index: a.index, quotaSpent: false };
      }
      return { status: 'ok', label: 'recorded, not live', runs, quotaSpent: false };
    },
    async offersheet_trial_pack_verify(a) {
      const packFile = a.packPath || defaultPackPath;
      let pack;
      let bench;
      try {
        // Size cap (fail-closed): the pack is a few KB, so a
        // caller-supplied path must never make this server slurp an
        // unbounded file into memory. The error never echoes the
        // caller-supplied path. (The path argument itself is preserved:
        // the tamper-check workflow passes a copy path, and this channel
        // is the operator's own stdio host, not a remote API — see the
        // security report for the same-privilege assessment.)
        const st = await stat(packFile);
        if (!st.isFile() || st.size > 1000000) throw new Error('pack file unusable');
        pack = JSON.parse(await readFile(packFile, 'utf8'));
      } catch (e) {
        throw new OfferError('NOT_FOUND', 404, 'Trial pack could not be read');
      }
      try {
        bench = JSON.parse(await readFile(benchPath, 'utf8'));
      } catch {
        throw new OfferError('NOT_FOUND', 404, 'Benchmark ledger could not be read');
      }
      const checks = [];
      const runs = Array.isArray(bench.runs) ? bench.runs : [];
      const trials = Array.isArray(pack.trials) ? pack.trials : [];
      checks.push({ check: 'pack version', passed: pack.version === 'offersheet-trial-pack-1', detail: pack.version ?? null });
      checks.push({ check: 'trial count matches ledger', passed: trials.length === runs.length, detail: `${trials.length} pack trials vs ${runs.length} ledger runs` });
      checks.push({ check: 'label recorded, not live', passed: typeof pack.label === 'string' && /recorded, not live/.test(pack.label), detail: pack.label ?? null });
      let perTrialOk = true;
      for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        const trial = trials[i];
        if (!trial) { perTrialOk = false; checks.push({ check: `trial ${i} present`, passed: false, detail: 'missing from pack' }); continue; }
        const core = { inputs: run.input, breakEvenTickets: run.breakEvenTickets, graphPick: run.graphPick, recordedAt: run.recordedAt };
        const hashOk = trial.sha256 === sha256(canon(core));
        const arithOk = Math.ceil(run.input.guarantee / run.input.ticketPrice) === run.breakEvenTickets;
        const fieldsOk = JSON.stringify(trial.inputs) === JSON.stringify(run.input) && trial.breakEvenTickets === run.breakEvenTickets && trial.graphPick === run.graphPick && trial.recordedAt === run.recordedAt;
        if (!hashOk || !arithOk || !fieldsOk) perTrialOk = false;
        checks.push({ check: `trial ${i} hash`, passed: hashOk, detail: trial.sha256 ?? null });
        checks.push({ check: `trial ${i} break-even arithmetic`, passed: arithOk, detail: `ceil(${run.input.guarantee}/${run.input.ticketPrice}) = ${run.breakEvenTickets}` });
        checks.push({ check: `trial ${i} fields match ledger`, passed: fieldsOk, detail: trial.graphPick ?? null });
      }
      const packHashOk = pack.packSha256 === sha256(trials.map((t) => t.sha256).join(''));
      checks.push({ check: 'packSha256', passed: packHashOk, detail: pack.packSha256 ?? null });
      const allPassed = checks.every((c) => c.passed) && perTrialOk;
      return { status: allPassed ? 'ok' : 'mismatch', allPassed, trialsChecked: runs.length, checks, quotaSpent: false };
    },
    async offersheet_arm_gut(a) {
      const out = await gutArmFn({ question: a.question });
      return { ...out, scope: 'LLM alone, no external data', quotaSpent: false };
    },
    async offersheet_arm_web(a) {
      let facts = Array.isArray(a.webFacts) ? a.webFacts : null;
      let factsSource = 'caller-supplied';
      if (facts === null) {
        if (typeof a.artist === 'string' && a.artist.trim()) {
          try {
            const w = await wikidataFn({ query: a.artist });
            facts = (w?.results || []).map((r) => `${r.label}${r.description ? ` — ${r.description}` : ''} (${r.id})`);
            factsSource = 'wikidata';
          } catch {
            facts = [];
            factsSource = 'wikidata (lookup failed — no facts)';
          }
        } else {
          facts = [];
          factsSource = 'none supplied';
        }
      }
      const out = await webArmFn({ question: a.question, webFacts: facts });
      return { ...out, webFacts: facts, factsSource, scope: 'LLM + Wikidata facts only — never a broader web search, never a direct verdict input', quotaSpent: false };
    },
    async offersheet_miss_trial_build(a) {
      const trial = buildMissTrial({ question: a.question, graphPick: a.graphPick, gutPick: a.gutPick, webPick: a.webPick });
      return { status: 'ok', trial, note: trial ? 'Trial exists only because a graph pick and at least one comparison pick are present.' : 'No trial: a graph pick and at least one comparison pick are both required.', quotaSpent: false };
    },
    async offersheet_venue_search(a) {
      if (!cfg.tmKeyConfigured) return { status: 'not_configured', venue: null, note: 'Ticketmaster key not configured — venue lookup unavailable, no venue is guessed.', quotaSpent: false };
      const vs = await tmVenuesFn({ keyword: a.keyword });
      if (!vs || !vs.ok) return { status: 'error', venue: null, reason: `Ticketmaster returned ${vs?.status ?? 'unknown'}`, quotaSpent: false };
      const venue = extractFirstVenueResult(vs.body);
      return { status: venue ? 'ok' : 'empty', venue, note: venue ? null : 'Named room did not resolve in Ticketmaster venue search — never a guessed venue.', quotaSpent: false };
    },
    async offersheet_room_grounding(a) {
      if (!cfg.tmKeyConfigured) return { status: 'not_configured', cause: 'not_configured', note: 'Ticketmaster key not configured — capacity leg unavailable.', eventsFound: null, venueName: null, capacity: { value: null, state: 'unknown', cause: 'not_configured' }, price: null, grounding: null, quotaSpent: false };
      const venueQuery = typeof a.venue === 'string' ? a.venue.trim() : '';
      let venueId = null;
      let resolvedVenue = null;
      let venueResolved = false;
      let venueSearchNote = null;
      if (venueQuery) {
        try {
          const vs = await tmVenuesFn({ keyword: venueQuery });
          if (vs.ok) {
            resolvedVenue = extractFirstVenueResult(vs.body);
            if (resolvedVenue) {
              venueResolved = true;
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
      }
      const ev = await tmEventsFn({ keyword: a.artist, city: a.city, ...(venueId ? { venueId } : {}) });
      if (!ev || !ev.ok) return { status: 'error', cause: 'error', reason: `Ticketmaster returned ${ev?.status ?? 'unknown'}`, eventsFound: null, venueName: null, capacity: { value: null, state: 'unknown', cause: 'error' }, price: null, grounding: null, quotaSpent: false };
      const eventsFound = Array.isArray(ev.body?._embedded?.events) ? ev.body._embedded.events.length : 0;
      const venue = extractFirstVenue(ev.body);
      const capacityValue = venueResolved ? (extractCapacity(resolvedVenue) ?? extractCapacity(venue)) : extractCapacity(venue);
      const priceRaw = extractPrice(ev.body);
      const price = priceRaw ? {
        value: priceRaw.price,
        source: venueResolved ? `${priceRaw.source} — events at the named room` : `${priceRaw.source} — first matching Ticketmaster event's venue, not the offer room`,
      } : null;
      const grounding = venueResolved
        ? 'named room — venue resolved by Ticketmaster venue search'
        : `first matching Ticketmaster event's venue, not the offer room${venueSearchNote ? ` (${venueSearchNote})` : ''}`;
      return {
        status: 'ok',
        eventsFound,
        venueName: (venueResolved ? resolvedVenue?.name : venue?.name) ?? null,
        capacity: capacityValue !== null ? { value: capacityValue, state: 'known', source: venueResolved ? 'Ticketmaster-reported' : 'Ticketmaster-reported — first matching Ticketmaster event\'s venue, not the offer room' } : { value: null, state: 'unknown', cause: 'no_field', message: 'Venue capacity unknown — Ticketmaster returned no capacity for this room.' },
        price,
        grounding,
        venueResolved,
        quotaSpent: false,
      };
    },
    async offersheet_deal_breakeven(a) {
      const provided = a.variableCostProvided !== undefined ? a.variableCostProvided : (a.variableCost !== undefined);
      let be;
      try {
        be = breakEven({ guarantee: a.guarantee, ticketPrice: a.ticketPrice, variableCost: a.variableCost ?? 0, capacity: a.capacity ?? null });
      } catch (e) {
        throw invalidInput(e.message);
      }
      return { status: 'ok', tickets: be.tickets, net: be.net, note: be.note, verdict: be.verdict, capacity: be.capacity, variableCost: { value: provided ? be.variableCost : null, provided }, quotaSpent: false };
    },
    async offersheet_city_geocode(a) {
      const scope = 'display-only — shown for confirmation, never fed into Qloo filters';
      const g = await geocodeFn({ query: a.query });
      if (!g || !g.ok || !g.result) return { status: 'unavailable', result: null, scope, note: 'City used as typed; location filters omitted.', quotaSpent: false };
      return { status: 'ok', result: g.result, displayName: g.result.displayName, lat: g.result.lat, lon: g.result.lon, scope, quotaSpent: false };
    },
    async offersheet_artist_facts(a) {
      const scope = 'input to the Web arm only, never a direct verdict input';
      const w = await wikidataFn({ query: a.query, limit: a.limit ?? 5 });
      if (!w || !w.ok) return { status: 'error', results: [], reason: `Wikidata returned ${w?.status ?? 'unknown'}`, scope, quotaSpent: false };
      return { status: 'ok', results: w.results || [], scope, quotaSpent: false };
    },
    async offersheet_health() {
      return { status: 'ok', version: SERVER_VERSION, qlooConfigured: Boolean(cfg.qlooKeyConfigured), ticketmasterConfigured: Boolean(cfg.tmKeyConfigured), llmConfigured: llmOk(), quotaSpent: false };
    },
    async offersheet_limits_status() {
      return {
        status: 'ok',
        ...guards.snapshot(),
        note: 'These are OfferSheet\'s own adopted tripwires, NOT Qloo-stated quotas. Restart clears guard counters and the session receipt store; no per-visitor usage lookup exists (Guards has no read method for it).',
        restartClears: 'guard counters and session receipts',
        quotaSpent: false,
      };
    },
    async offersheet_opener_shortlist(a) {
      // Sequential recommend -> rank sub-chain from pipeline.js, plus the
      // Gap-3 ID-threading step. Rank consumes recommend's output exactly;
      // the two steps are never parallelised.
      if (!cfg.qlooKeyConfigured) throw notConfigured();
      guards.resetRun();
      const call = async (tool, args) => {
        guards.checkCall();
        return mcpCall(tool, args);
      };
      const stepReceipts = [];
      const describeEnv = await call('qloo_describe', { entity: a.entityHint || a.artist, type: 'artist' });
      if (describeEnv?.status === 'needs_input') {
        return { status: 'needs_input', message: 'The headliner name matched multiple entities. Pick the one you mean — the shortlist never guesses.', candidates: namesOf(describeEnv.results), receipts: stepReceipts, quotaSpent: true };
      }
      const headlinerResults = Array.isArray(describeEnv?.results) ? describeEnv.results : [];
      if (describeEnv?.status === 'ok' && headlinerResults.length > 0) stepReceipts.push(recordMcp('headliner description', 'qloo_describe', { entity: a.entityHint || a.artist, type: 'artist' }, describeEnv));
      const headliner = headlinerResults[0] ? { id: itemId(headlinerResults[0]), name: itemName(headlinerResults[0]) } : null;
      const headlinerSignal = headliner?.id || headliner?.name || a.artist;
      const headlinerRef = headliner?.id || headlinerSignal;
      const recommendEnv = await call('qloo_recommend', { target_type: 'artist', signals: [headlinerSignal], limit: 10 });
      const candidates = namesOf(recommendEnv?.results);
      if (recommendEnv?.status === 'ok' && candidates.length > 0) stepReceipts.push(recordMcp('opener candidates from headliner fans', 'qloo_recommend', { target_type: 'artist', signals: [headlinerSignal], limit: 10 }, recommendEnv));
      let ranked = [];
      let rankStatus = { status: 'skipped', reason: 'no opener candidates to rank' };
      if (candidates.length > 0) {
        const rankOptions = candidates.map((c) => c.id || c.name).filter(Boolean);
        const rankEnv = await call('qloo_rank', { options: rankOptions, option_type: 'artist', signals: [headlinerRef], signal_location: a.city });
        ranked = namesOf(rankEnv?.results);
        rankStatus = { status: rankEnv?.status ?? 'ok' };
        if (rankEnv?.status === 'ok' && ranked.length > 0) stepReceipts.push(recordMcp('opener shortlist ranked for the city audience', 'qloo_rank', { options: rankOptions, option_type: 'artist', signals: [headlinerRef], signal_location: a.city }, rankEnv));
      }
      const topPick = ranked[0] || candidates[0] || null;
      // Gap-3 ID threading: an ID-less top pick gets one describe call; a
      // failed or ambiguous resolution keeps the name signal, never a
      // guessed ID. This helper leaves no receipt, as in the pipeline.
      let openerId = topPick?.id || null;
      if (topPick && !openerId && topPick.name) {
        try {
          const resolved = await call('qloo_describe', { entity: topPick.name, type: 'artist' });
          if (resolved && resolved.status !== 'needs_input' && Array.isArray(resolved.results) && resolved.results.length > 0) {
            openerId = itemId(resolved.results[0]);
          }
        } catch { /* name signal kept below */ }
      }
      return {
        status: 'ok',
        artist: a.artist,
        city: a.city,
        headliner,
        candidates,
        ranked,
        rank: rankStatus,
        topPick: topPick?.name || null,
        topPickId: openerId,
        openerRef: openerId || topPick?.name || null,
        receipts: stepReceipts,
        quotaSpent: true,
      };
    },
    async offersheet_opener_rerank(a) {
      // G17 (superiority): the HTTP POST /api/verdict/rerank endpoint, as
      // an MCP tool — 1:1 reuse, no duplicated rank logic. The same
      // buildRerankArgs (same candidate set minus the excluded pick, same
      // throws for absent-excluded / nothing-remaining, mapped to
      // INVALID_INPUT by the tools/call dispatcher exactly as the HTTP
      // endpoint maps them) feeds one qloo_rank call, and the same
      // formatRerankResult shapes the result. The receipt claim matches
      // the HTTP endpoint's. One honest transport difference: the HTTP
      // endpoint maps a non-ok result to 502 RERANK_EMPTY, while this tool
      // returns the same result object with status 'empty'/'error' and no
      // pick — MCP tools return success responses carrying their status,
      // and the empty label is identical. excludedPick accepts a pick name
      // string or an {id, name} object, as buildRerankArgs does; the
      // validator has no union type, so the def leaves its type open and
      // buildRerankArgs is the validator for this argument.
      if (!cfg.qlooKeyConfigured) throw notConfigured();
      guards.resetRun();
      let built;
      try {
        built = buildRerankArgs({
          artist: a.artist,
          city: a.city,
          candidates: a.candidates,
          ranked: a.ranked,
          excludedPick: a.excludedPick,
          headlinerId: a.headlinerId,
        });
      } catch (e) {
        // Same mapping as the HTTP endpoint: an unusable exclusion set is
        // an input error, never an upstream failure.
        throw invalidInput(e.message);
      }
      const { remaining: _remaining, ...rankArgs } = built;
      const call = async (tool, args) => {
        guards.checkCall();
        return mcpCall(tool, args);
      };
      const rankEnv = await call('qloo_rank', rankArgs);
      const rankResults = Array.isArray(rankEnv?.results) ? rankEnv.results : [];
      const receipt = (rankEnv?.status === 'ok' && rankResults.length > 0)
        ? recordMcp('opener shortlist re-ranked without the top pick', 'qloo_rank', rankArgs, rankEnv)
        : null;
      return { ...formatRerankResult(rankEnv, { excludedPick: a.excludedPick, receipt }), quotaSpent: true };
    },
  };

  function compareIds(freshIds, originalIds) {
    if (!Array.isArray(originalIds)) return { status: 'not_comparable', reason: 'no originalIds supplied' };
    if (!Array.isArray(freshIds) || freshIds.length === 0) return { status: 'not_comparable', reason: 'fresh result carries no entity IDs — demographics/overlap-style receipts honestly report not_comparable, never a match on an empty list' };
    const match = freshIds.length === originalIds.length && freshIds.every((id, i) => id === originalIds[i]);
    return { status: match ? 'match' : 'mismatch', freshIds, originalIds };
  }

  return { cfg, guards, receipts, handlers, compareIds };
}

// ---- tool catalogue (spec §1, names character-for-character) ------------
const Q = 'Spends Qloo quota (guarded).';
const NQ = 'Spends no Qloo calls.';
const verdictProps = {
  artist: { type: 'string', required: true },
  city: { type: 'string', required: true },
  guarantee: { type: 'number', required: true, min: 0 },
  ticketPrice: { type: 'number', gt: 0 },
  variableCost: { type: 'number', min: 0 },
  capacity: { type: 'number', gt: 0 },
  venue: { type: 'string' },
  entityHint: { type: 'string' },
};
function toolDef(name, description, props, handlerKey) {
  const required = Object.entries(props).filter(([, p]) => p.required).map(([k]) => k);
  return { name, description, inputSchema: { type: 'object', properties: wireSchema(props), required, additionalProperties: false }, _props: props, _handler: handlerKey };
}
export function buildToolDefs() {
  return [
    toolDef('offersheet_verdict_run', `Runs the full OfferSheet verdict (Qloo evidence + Ticketmaster room + money + arms). Does NOT invent numbers: a withheld, price-unknown, or needs-input verdict is a success response with that status, never a number. ${Q}`, verdictProps, 'offersheet_verdict_run'),
    toolDef('offersheet_verdict_race', `Same verdict as offersheet_verdict_run, plus arm timings (race: gutMs, webMs, totalMs). Does NOT change the verdict; it proves arm timing, which the plain verdict does not report. ${Q}`, verdictProps, 'offersheet_verdict_race'),
    toolDef('qloo_capabilities', `Guarded proxy of Qloo's own qloo_capabilities tool (the pipeline readiness probe). Returns the upstream envelope plus an OfferSheet receipt. Does NOT invent a capability list when the harness is down — that errors. ${Q}`, { operation_ids: { type: 'array', itemsType: 'string' } }, 'qloo_capabilities'),
    toolDef('qloo_find_tags', `Guarded proxy of Qloo's own qloo_find_tags tool. Tag URNs returned here feed the REST insights leg. Does NOT resolve an artist by itself. ${Q}`, { query: { type: 'string', required: true }, limit: { type: 'number', integer: true, min: 1 } }, 'qloo_find_tags'),
    toolDef('qloo_describe', `Guarded proxy of Qloo's own qloo_describe tool. An ambiguous name returns needs_input with candidates — it is never resolved by guessing. ${Q}`, { entity: { type: 'string', required: true }, type: { type: 'string' } }, 'qloo_describe'),
    toolDef('qloo_recommend', `Guarded proxy of Qloo's own qloo_recommend tool (opener candidates for a headliner signal). Does NOT rank the candidates — that is qloo_rank, or the sequenced offersheet_opener_shortlist. ${Q}`, { target_type: { type: 'string', required: true }, signals: { type: 'array', itemsType: 'string', required: true }, limit: { type: 'number', integer: true, min: 1 } }, 'qloo_recommend'),
    toolDef('qloo_rank', `Guarded proxy of Qloo's own qloo_rank tool. It ranks options a caller supplies; it does NOT generate candidates. ${Q}`, { options: { type: 'array', itemsType: 'string', required: true }, option_type: { type: 'string', required: true }, signals: { type: 'array', itemsType: 'string', required: true }, signal_location: { type: 'string' } }, 'qloo_rank'),
    toolDef('qloo_where_popular', `Guarded proxy of Qloo's own qloo_where_popular tool. Returns matched areas/entities only — Qloo returns no headcount, and this tool does NOT invent one. ${Q}`, { entity: { type: 'string', required: true }, within: { type: 'string' }, limit: { type: 'number', integer: true, min: 1 } }, 'qloo_where_popular'),
    toolDef('qloo_audience_demographics', `Guarded proxy of Qloo's own qloo_audience_demographics tool. Bands carry no entity IDs, so their receipts honestly carry no ID list. ${Q}`, { entity: { type: 'string', required: true }, entity_type: { type: 'string' } }, 'qloo_audience_demographics'),
    toolDef('qloo_entity_tags', `Guarded proxy of Qloo's own qloo_entity_tags tool (shared tags for a set of entities). One of the two accepted overlap evidences, alongside qloo_compare_audiences. ${Q}`, { entities: { type: 'array', itemsType: 'string', required: true }, entity_type: { type: 'string' }, limit: { type: 'number', integer: true, min: 1 } }, 'qloo_entity_tags'),
    toolDef('qloo_trends', `Guarded proxy of Qloo's own qloo_trends tool (momentum over a date window). A failure is a labeled omission in a verdict, never a verdict blocker. ${Q}`, { entities: { type: 'array', itemsType: 'string', required: true }, entity_type: { type: 'string' }, start_date: { type: 'string' }, end_date: { type: 'string' } }, 'qloo_trends'),
    toolDef('qloo_compare_audiences', `Guarded proxy of Qloo's own qloo_compare_audiences tool (audience-overlap object for two groups). Distinct from qloo_entity_tags (shared-tag list) and from offersheet_rest_compare (REST transport). ${Q}`, { group_a: { type: 'array', itemsType: 'string', required: true }, group_b: { type: 'array', itemsType: 'string', required: true }, target_type: { type: 'string', required: true } }, 'qloo_compare_audiences'),
    toolDef('offersheet_rest_search', `REST name resolution via GET /search (key in the X-Api-Key header only, never in the URL). Accepts entities- or results-shaped bodies. Does NOT spend an MCP call. ${Q}`, { query: { type: 'string', required: true }, take: { type: 'number', integer: true, min: 1 } }, 'offersheet_rest_search'),
    toolDef('offersheet_rest_insights_by_tags', `REST insights by tag URNs via GET /v2/insights with explainability on. Runs only when tag URNs are supplied; otherwise the caller reports it skipped. ${Q}`, { tagUrns: { type: 'array', itemsType: 'string', required: true, urn: true }, filterType: { type: 'string' } }, 'offersheet_rest_insights_by_tags'),
    toolDef('offersheet_rest_compare', `REST headliner-vs-opener comparison via GET /v2/analysis/compare. An object body with non-error keys counts as a payload. ${Q}`, { aIds: { type: 'array', itemsType: 'string', required: true }, bIds: { type: 'array', itemsType: 'string', required: true } }, 'offersheet_rest_compare'),
    toolDef('offersheet_rest_entities', `REST entity hydration via GET /entities. At most 15 IDs are sent per call (enforced, not advisory) — extra IDs are not sent. ${Q}`, { ids: { type: 'array', itemsType: 'string', required: true } }, 'offersheet_rest_entities'),
    toolDef('offersheet_receipt_replay', `Re-runs a receipted call live (MCP allowlist or REST allowlist) and compares fresh ordered entity IDs against originalIds (match / mismatch / not_comparable). The Qloo key gate precedes validation: a keyless bogus replay returns NOT_CONFIGURED before any other check. Demographics/overlap receipts carry no IDs, so they honestly report not_comparable. ${Q}`, { kind: { type: 'string', required: true, enum: ['mcp', 'rest'] }, tool: { type: 'string' }, args: { type: 'object' }, path: { type: 'string' }, params: { type: 'object' }, originalIds: { type: 'array', itemsType: 'string' } }, 'offersheet_receipt_replay'),
    toolDef('offersheet_receipt_verify_hash', `Recomputes a receipt's SHA-256 offline (MCP: tool + args; REST: method + url) and reports valid true/false plus the recomputed hash. Does NOT make a live call and does NOT prove the upstream data — only that the hash matches the claimed request. ${NQ}`, { operation: { type: 'string', required: true }, requestHash: { type: 'string', required: true }, tool: { type: 'string' }, args: { type: 'object' }, method: { type: 'string' }, url: { type: 'string' } }, 'offersheet_receipt_verify_hash'),
    toolDef('offersheet_receipts_list', `Lists receipts from the session store (this process only; restart clears it) or reads the repo manifest (read-only; currently empty, returned verbatim with its note). The id / requestHash / operation parameters ARE the get operation — there is no separate get tool. This server never writes either source. ${NQ}`, { source: { type: 'string', enum: ['session', 'manifest'] }, id: { type: 'string' }, requestHash: { type: 'string' }, operation: { type: 'string' } }, 'offersheet_receipts_list'),
    toolDef('offersheet_trials_list', `Lists recorded benchmark trials from bench/results.json, labeled recorded, not live on every response. The index parameter IS the get operation. A missing file returns the honest no-runs note, never fabricated runs. ${NQ}`, { index: { type: 'number', integer: true, min: 0 } }, 'offersheet_trials_list'),
    toolDef('offersheet_trial_pack_verify', `Offline verification of frontend/trial-pack.json against bench/results.json: per-trial SHA-256 over the canonicalised core, packSha256 over the joined hashes, and every breakEvenTickets re-derived by ceiling division. Reports exactly which check failed. No Qloo call, no quota. ${NQ}`, { packPath: { type: 'string' } }, 'offersheet_trial_pack_verify'),
    toolDef('offersheet_arm_gut', `The Gut comparison arm: LLM alone, no external data. When no LLM provider is configured it returns status unavailable with no pick — never a rendered guess. ${NQ}`, { question: { type: 'string', required: true } }, 'offersheet_arm_gut'),
    toolDef('offersheet_arm_web', `The Web comparison arm: LLM plus Wikidata facts only. When webFacts is absent and artist is given, facts are fetched via the Wikidata path first; empty facts still produce an honest run labeled with no Wikidata facts available, never invented facts. ${NQ}`, { question: { type: 'string', required: true }, webFacts: { type: 'array', itemsType: 'string' }, artist: { type: 'string' } }, 'offersheet_arm_web'),
    toolDef('offersheet_miss_trial_build', `Builds a miss-ledger trial from picks, purely offline. Returns null (no trial) unless a graph pick AND at least one comparison pick are present; identical picks yield a trial with empty misses. ${NQ}`, { question: { type: 'string', required: true }, graphPick: { type: 'string', required: true }, gutPick: { type: 'string' }, webPick: { type: 'string' } }, 'offersheet_miss_trial_build'),
    toolDef('offersheet_venue_search', `Raw Ticketmaster venue lookup for a named room. A null result means the room did not resolve — never a guessed venue. This answers the lookup alone, without spending an events call. Spends no Qloo calls.`, { keyword: { type: 'string', required: true } }, 'offersheet_venue_search'),
    toolDef('offersheet_room_grounding', `The composed Ticketmaster room leg: resolve a named room first, then scope the event lookup to its venue ID. Returns events found, venue name, capacity (value or unknown with its cause), price (value + source), and the grounding label — a resolved room's capacity is never borrowed from another room's event, and a first-event price/capacity is never silently labeled as the offer room's. Spends no Qloo calls.`, { artist: { type: 'string', required: true }, city: { type: 'string', required: true }, venue: { type: 'string' } }, 'offersheet_room_grounding'),
    toolDef('offersheet_deal_breakeven', `Pure break-even arithmetic: tickets = ceil(guarantee / (ticketPrice - variableCost)); guarantee 0 gives 0 tickets with note no guarantee; net <= 0 is an error, never division by zero; tickets over a known capacity give Cannot break even in this room at this guarantee. A missing ticket price is an error, never an invented number. variableCostProvided keeps a blank cost distinct from zero cost. ${NQ}`, { guarantee: { type: 'number', required: true, min: 0 }, ticketPrice: { type: 'number', required: true, gt: 0 }, variableCost: { type: 'number', min: 0 }, capacity: { type: 'number', gt: 0 }, variableCostProvided: { type: 'boolean' } }, 'offersheet_deal_breakeven'),
    toolDef('offersheet_city_geocode', `Keyless Nominatim city lookup (display name + lat/lon, or unavailable). Scope label on every response: display-only — shown for confirmation, never fed into Qloo filters. A failure never yields a guessed coordinate. Spends no Qloo calls.`, { query: { type: 'string', required: true } }, 'offersheet_city_geocode'),
    toolDef('offersheet_artist_facts', `Wikidata name-to-entity search only (id / label / description matches). Scope label on every response: input to the Web arm only, never a direct verdict input. No claim is ever derived from Wikidata alone. Spends no Qloo calls.`, { query: { type: 'string', required: true }, limit: { type: 'number', integer: true, min: 1 } }, 'offersheet_artist_facts'),
    toolDef('offersheet_health', `Booleans only — qlooConfigured, ticketmasterConfigured, llmConfigured — plus status ok and version. No keys, no counts, no guard internals. Works with no keys configured; it is the tool that tells a client whether the others can work. ${NQ}`, {}, 'offersheet_health'),
    toolDef('offersheet_limits_status', `The server process's single Guards snapshot: monthlyBudget, monthlyCount, perVisitorDailyCap, perRunCallCap. These are OfferSheet's own adopted tripwires, NOT Qloo-stated quotas. Restart clears guard counters and the session receipt store. There is NO per-visitor usage lookup — Guards has no read method for it — so none is invented here. ${NQ}`, {}, 'offersheet_limits_status'),
    toolDef('offersheet_opener_shortlist', `The composed opener chain: resolve the headliner, recommend opener candidates, then rank those candidates for the city audience — rank consumes recommend's output, so the steps stay sequential, never parallelised. Plus Gap-3 ID threading: an ID-less candidate gets one describe call before downstream use; a failed or ambiguous resolution keeps the name signal, never a guessed ID. Distinct from the plain verdict (no guarantee, no money, no full evidence legs, no venue/arms) and from calling recommend + rank by hand (the sequencing + ID threading is the logic). When recommend is empty, rank is honestly skipped, never an empty ranking presented as a pick. ${Q}`, { artist: { type: 'string', required: true }, city: { type: 'string', required: true }, entityHint: { type: 'string' } }, 'offersheet_opener_shortlist'),
    toolDef('offersheet_opener_rerank', `The HTTP POST /api/verdict/rerank endpoint as a tool, reusing its logic 1:1 (buildRerankArgs + one qloo_rank call + formatRerankResult, same receipt claim). Re-runs ONLY the ranking step with the same candidate set minus the excluded pick; the original verdict is never touched. An ok-but-empty rank envelope returns status 'empty' with the exact label and no pick — never an invented pick. excludedPick accepts a pick name string or an {id, name} object, as buildRerankArgs does. ${Q}`, { artist: { type: 'string', required: true }, city: { type: 'string', required: true }, candidates: { type: 'array' }, ranked: { type: 'array' }, excludedPick: { required: true }, headlinerId: { type: 'string' } }, 'offersheet_opener_rerank'),
  ];
}

// ---- JSON-RPC handling ---------------------------------------------------
export function createMcpServer(deps = {}) {
  const app = createMcpApp(deps);
  const defs = buildToolDefs();
  const byName = new Map(defs.map((d) => [d.name, d]));

  async function handleRequest(msg) {
    if (!msg || typeof msg !== 'object') return null;
    const isNotification = msg.id === undefined;
    if (msg.method === 'notifications/initialized' || (typeof msg.method === 'string' && msg.method.startsWith('notifications/'))) {
      diag(msg.method, null, 'ok');
      return null;
    }
    if (msg.method === 'initialize') {
      diag('initialize', null, 'ok');
      return { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } } };
    }
    if (msg.method === 'ping') {
      return { jsonrpc: '2.0', id: msg.id, result: {} };
    }
    if (msg.method === 'tools/list') {
      diag('tools/list', null, 'ok');
      return { jsonrpc: '2.0', id: msg.id, result: { tools: defs.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } };
    }
    if (msg.method === 'tools/call') {
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      const def = byName.get(name);
      if (!def) {
        diag('tools/call', name ?? null, 'unknown_tool');
        return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ code: 'INVALID_INPUT', message: `Unknown tool: ${name}` }) }], isError: true } };
      }
      try {
        validateArgs(name, def._props, args);
        const payload = await app.handlers[def._handler](args);
        diag('tools/call', name, 'ok');
        return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } };
      } catch (e) {
        const p = errPayload(e);
        diag('tools/call', name, p.code);
        return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(p) }], isError: true } };
      }
    }
    if (isNotification) return null;
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }

  return { app, defs, handleRequest, close: () => {} };
}

// ---- stdio entry point ---------------------------------------------------
// Runs only when this file itself is the node entry point (node
// backend/mcp-server.js). Importing it from tests never starts stdio.
import { realpathSync } from 'node:fs';
const entryPath = (() => {
  try { return process.argv[1] ? realpathSync(process.argv[1]) : null; } catch { return null; }
})();
if (entryPath === fileURLToPath(import.meta.url)) {
  const server = createMcpServer();
  process.stderr.write('[mcp] offersheet mcp server started; restart clears guard counters and session receipts\n');
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const res = await server.handleRequest(msg);
      if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
    }
  });
}
