// MCP stdio client for `qloo mcp` (official harness, JSON-RPC 2.0 over NDJSON).
// Transport rules (official starter): spawn `qloo mcp`, pass env: process.env so
// QLOO_API_KEY forwards to the server. One session per verdict request: start(),
// call() for each tool in sequence, close(). No key is ever logged: args contain
// no keys, and envelopes are returned verbatim (error codes only, no credentials).
import { spawn } from 'node:child_process';
import { mapEnvelopeError, invalidInput } from './errors.js';

const PROTOCOL_VERSION = '2024-11-05';

// G6: replay allowlist — exactly the 10 official `qloo mcp` tools. Any other
// tool name is rejected before a session is spawned.
export const MCP_TOOLS = [
  'qloo_capabilities',
  'qloo_find_tags',
  'qloo_describe',
  'qloo_recommend',
  'qloo_rank',
  'qloo_where_popular',
  'qloo_compare_audiences',
  'qloo_audience_demographics',
  'qloo_entity_tags',
  'qloo_trends',
];

// T1 (provenance): per-tool argument-KEY allowlist for replay. The keys are
// exactly the keys the verdict pipeline, the re-rank path, and the routing
// step send for each tool — observed call shapes, not an upstream schema,
// so no value-type claim is made here. An unknown key is rejected before
// any session is spawned: without this, an extra key the upstream silently
// ignores would re-run a DIFFERENT call that still returns the same IDs
// and stamps a false "match". Known-key wrong-type values still reach the
// upstream and fail there, surfacing as a replay failure — never a match.
// qloo_capabilities takes no keys from any verdict receipt (the readiness
// probe sends {}); the capabilities() helper's operation_ids has no caller
// and no receipt, so it is deliberately NOT allowlisted — if a caller is
// ever added, this table must gain it in the same change.
// CORRECTION (receipt-gap closure): the MCP server's qloo_capabilities
// proxy tool DOES accept operation_ids (its tool definition declares it),
// so a proxy capabilities receipt carrying operation_ids could not be
// replayed under the old [] allowlist. The table now matches the proxy
// definition exactly; the verdict readiness probe still sends {}.
export const MCP_ARG_ALLOWLIST = {
  qloo_capabilities: ['operation_ids'],
  qloo_find_tags: ['query', 'limit'],
  qloo_describe: ['entity', 'type'],
  qloo_recommend: ['target_type', 'signals', 'limit'],
  qloo_rank: ['options', 'option_type', 'signals', 'signal_location'],
  qloo_where_popular: ['entity', 'within', 'limit'],
  qloo_compare_audiences: ['group_a', 'group_b', 'target_type'],
  qloo_audience_demographics: ['entity', 'entity_type'],
  qloo_entity_tags: ['entities', 'entity_type', 'limit'],
  qloo_trends: ['entities', 'entity_type', 'start_date', 'end_date'],
};

// Validate a replay's MCP tool + args against the allowlists above. Throws
// OfferError (INVALID_INPUT, 400) on the first violation. Pure function —
// no session, no network — so tests cover it without a harness.
export function validateMcpReplayArgs(tool, args) {
  if (!MCP_TOOLS.includes(tool)) {
    throw invalidInput(`Replay tool not allowlisted: ${tool}`);
  }
  if (args === undefined || args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw invalidInput('Replay MCP args must be an object');
  }
  const allowed = MCP_ARG_ALLOWLIST[tool] || [];
  for (const k of Object.keys(args)) {
    if (!allowed.includes(k)) {
      throw invalidInput(`Replay MCP arg not allowlisted for ${tool}: ${k}`);
    }
  }
}

export class McpSession {
  constructor({ command = 'qloo', args = ['mcp'], timeoutMs = 60000, spawnFn = spawn } = {}) {
    this.command = command;
    this.args = args;
    this.timeoutMs = timeoutMs;
    this.spawnFn = spawnFn;
    this.child = null;
    this.buf = '';
    this.pending = new Map();
    this.nextId = 1;
    this.started = false;
  }

  start() {
    if (this.started) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.child = this.spawnFn(this.command, this.args, {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => {
        this.close();
        reject(new Error('MCP start timed out'));
      }, this.timeoutMs);
      this.child.stderr.on('data', () => {});
      this.child.stdout.on('data', (d) => {
        this.buf += d.toString();
        let idx;
        while ((idx = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, idx).trim();
          this.buf = this.buf.slice(idx + 1);
          if (!line) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve: res, reject: rej, timeout } = this.pending.get(msg.id);
            clearTimeout(timeout);
            this.pending.delete(msg.id);
            if (msg.error) rej(new Error(`MCP error: ${JSON.stringify(msg.error)}`));
            else res(msg.result);
          }
        }
      });
      this.child.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`MCP spawn failed: ${e.message}`));
      });
      this.child.on('exit', () => {
        for (const { reject: rej, timeout } of this.pending.values()) {
          clearTimeout(timeout);
          rej(new Error('MCP process exited'));
        }
        this.pending.clear();
      });
      this._request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'offersheet', version: '0.1.0' },
      }).then(() => {
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
        this.started = true;
        clearTimeout(timer);
        resolve();
      }).catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  _request(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId;
      this.nextId += 1;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  // Call one tool. Returns the parsed envelope: {status, summary, results,
  // result_count, error?}. Throws OfferError on envelope error (mapped).
  async call(tool, args) {
    const result = await this._request('tools/call', { name: tool, arguments: args });
    const content = result?.content?.[0];
    let envelope = null;
    if (content && content.type === 'text') {
      try {
        envelope = JSON.parse(content.text);
      } catch {
        envelope = null;
      }
    }
    if (!envelope) {
      // Non-JSON content or isError without an envelope: surface as an error state.
      if (result?.isError) throw mapEnvelopeError({ error: { code: 'QLOO_ERROR' } });
      return { status: 'empty', summary: '', results: [], result_count: 0, raw: result };
    }
    if (envelope.status === 'error') throw mapEnvelopeError(envelope);
    return envelope;
  }

  async capabilities(operationIds) {
    const args = operationIds ? { operation_ids: operationIds } : {};
    return this.call('qloo_capabilities', args);
  }

  close() {
    try {
      this.child?.kill();
    } catch {
      // already exited
    }
    this.started = false;
  }
}
