// LLM provider fallback chain (arms.js): primary-fails -> fallback-succeeds,
// all-fail -> unavailable (never fabricated), legacy LLM_* still works,
// provider order respected, partially configured providers skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runGutArm, runWebArm, llmConfigured, configuredProviders } from '../backend/src/arms.js';

const ENV_KEYS = [
  'AI_PRIMARY_PROVIDER', 'AI_FALLBACK_PROVIDERS',
  'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL',
  'QWEN_BASE_URL', 'QWEN_API_KEY', 'QWEN_MODEL',
  'GROQ_BASE_URL', 'GROQ_API_KEY', 'GROQ_MODEL',
  'CEREBRAS_BASE_URL', 'CEREBRAS_API_KEY', 'CEREBRAS_MODEL',
];

function saveEnv() {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  return saved;
}

function restoreEnv(saved) {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

function setChain(primary, fallbacks, configs) {
  process.env.AI_PRIMARY_PROVIDER = primary;
  process.env.AI_FALLBACK_PROVIDERS = fallbacks;
  for (const [name, cfg] of Object.entries(configs)) {
    const up = name.toUpperCase();
    if (cfg.baseUrl) process.env[`${up}_BASE_URL`] = cfg.baseUrl;
    if (cfg.key) process.env[`${up}_API_KEY`] = cfg.key;
    if (cfg.model) process.env[`${up}_MODEL`] = cfg.model;
  }
}

// Stub fetch: behavior keyed by base URL. Each entry: { ok, status, text }.
// Records call order in `calls`.
function stubFetch(behaviors, calls) {
  return async (url) => {
    calls.push(url);
    for (const [base, b] of Object.entries(behaviors)) {
      if (url.startsWith(base)) {
        if (b.throw) throw new Error(b.throw);
        return {
          ok: b.ok,
          status: b.status ?? (b.ok ? 200 : 500),
          json: async () => (b.text === undefined ? {} : { choices: [{ message: { content: b.text } }] }),
        };
      }
    }
    throw new Error(`unexpected URL ${url}`);
  };
}

const Q = { baseUrl: 'https://qwen.example/v1', key: 'k-q', model: 'm-q' };
const G = { baseUrl: 'https://groq.example/v1', key: 'k-g', model: 'm-g' };
const C = { baseUrl: 'https://cerebras.example/v1', key: 'k-c', model: 'm-c' };

test('primary succeeds: fallback never called, provider named', async () => {
  const saved = saveEnv();
  try {
    setChain('qwen', 'groq', { qwen: Q, groq: G });
    const calls = [];
    const out = await runGutArm({
      question: 'Q?',
      fetchImpl: stubFetch({ [Q.baseUrl]: { ok: true, text: 'Opener A' }, [G.baseUrl]: { ok: true, text: 'Opener B' } }, calls),
    });
    assert.equal(out.status, 'ok');
    assert.equal(out.pick, 'Opener A');
    assert.equal(out.provider, 'qwen');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith(Q.baseUrl));
  } finally { restoreEnv(saved); }
});

test('primary 500 -> fallback succeeds, order respected', async () => {
  const saved = saveEnv();
  try {
    setChain('qwen', 'groq', { qwen: Q, groq: G });
    const calls = [];
    const out = await runGutArm({
      question: 'Q?',
      fetchImpl: stubFetch({ [Q.baseUrl]: { ok: false, status: 500 }, [G.baseUrl]: { ok: true, text: 'Opener B' } }, calls),
    });
    assert.equal(out.status, 'ok');
    assert.equal(out.pick, 'Opener B');
    assert.equal(out.provider, 'groq');
    assert.deepEqual(calls.map((u) => u.split('/')[2]), ['qwen.example', 'groq.example']);
  } finally { restoreEnv(saved); }
});

test('primary transport error and empty content both fall through', async () => {
  const saved = saveEnv();
  try {
    setChain('qwen', 'groq,cerebras', { qwen: Q, groq: G, cerebras: C });
    const calls = [];
    const out = await runWebArm({
      question: 'Q?', webFacts: ['fact'],
      fetchImpl: stubFetch({
        [Q.baseUrl]: { throw: 'boom' },
        [G.baseUrl]: { ok: true, text: undefined },
        [C.baseUrl]: { ok: true, text: 'Opener C' },
      }, calls),
    });
    assert.equal(out.status, 'ok');
    assert.equal(out.provider, 'cerebras');
    assert.equal(calls.length, 3);
  } finally { restoreEnv(saved); }
});

test('all providers fail -> unavailable, reason names all providers failed', async () => {
  const saved = saveEnv();
  try {
    setChain('qwen', 'groq', { qwen: Q, groq: G });
    const gut = await runGutArm({
      question: 'Q?',
      fetchImpl: stubFetch({ [Q.baseUrl]: { ok: false, status: 503 }, [G.baseUrl]: { throw: 'down' } }, []),
    });
    assert.equal(gut.status, 'unavailable');
    assert.match(gut.reason, /All LLM providers failed/);
    assert.equal(gut.pick, undefined);
    const web = await runWebArm({
      question: 'Q?', webFacts: [],
      fetchImpl: stubFetch({ [Q.baseUrl]: { ok: false, status: 503 }, [G.baseUrl]: { throw: 'down' } }, []),
    });
    assert.equal(web.status, 'unavailable');
  } finally { restoreEnv(saved); }
});

test('legacy LLM_* still works as a single provider', async () => {
  const saved = saveEnv();
  try {
    delete process.env.AI_PRIMARY_PROVIDER;
    delete process.env.AI_FALLBACK_PROVIDERS;
    process.env.LLM_BASE_URL = 'https://legacy.example/v1';
    process.env.LLM_API_KEY = 'k-l';
    process.env.LLM_MODEL = 'm-l';
    assert.equal(llmConfigured(), true);
    assert.deepEqual(configuredProviders().map((p) => p.name), ['legacy']);
    const out = await runGutArm({
      question: 'Q?',
      fetchImpl: stubFetch({ 'https://legacy.example/v1': { ok: true, text: 'Legacy Pick' } }, []),
    });
    assert.equal(out.status, 'ok');
    assert.equal(out.provider, 'legacy');
  } finally { restoreEnv(saved); }
});

test('llmConfigured: false when nothing, false when partial, true when one fallback complete', () => {
  const saved = saveEnv();
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    assert.equal(llmConfigured(), false);
    setChain('qwen', 'groq', { qwen: { baseUrl: Q.baseUrl, key: Q.key } }); // no model
    assert.equal(llmConfigured(), false);
    assert.deepEqual(configuredProviders(), []);
    setChain('qwen', 'groq', { groq: G }); // primary partial, fallback complete
    assert.equal(llmConfigured(), true);
    assert.deepEqual(configuredProviders().map((p) => p.name), ['groq']);
  } finally { restoreEnv(saved); }
});

test('unconfigured arms stay unavailable with the existing wording', async () => {
  const saved = saveEnv();
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    const gut = await runGutArm({ question: 'Q?', fetchImpl: async () => { throw new Error('must not be called'); } });
    assert.equal(gut.status, 'unavailable');
    assert.equal(gut.reason, 'LLM arm not configured — no pick rendered');
  } finally { restoreEnv(saved); }
});
