// Gut arm (LLM alone) and Web arm (LLM + Wikidata facts) — the two comparison
// arms beside the Qloo-grounded Graph arm. G9: the Web arm's facts come
// solely from Wikidata search results — no broader web search is ever
// called, so the label must name Wikidata and nothing broader.
// Provider rule: the LLM provider chain is pluggable via environment ONLY.
// Order comes from AI_PRIMARY_PROVIDER + AI_FALLBACK_PROVIDERS (comma
// separated, e.g. "groq,cerebras"); each provider's config comes from
// <UPPER_NAME>_BASE_URL + <UPPER_NAME>_API_KEY + <UPPER_NAME>_MODEL,
// OpenAI-compatible chat-completions shape. Legacy single-provider env
// (LLM_BASE_URL + LLM_API_KEY + LLM_MODEL) still works when no AI_* chain
// is configured. Providers are tried in order; on a non-ok HTTP status, a
// transport error, or empty content the next provider is tried. If ALL
// providers fail, both arms return status 'unavailable' with a reason
// stating all providers failed — NEVER a fabricated pick. A pick is only
// ever a real model output, and the answering provider is named on the
// result so trials can record which provider answered.
// Miss-ledger rule: a ledger trial exists ONLY when the Graph pick and at
// least one comparison pick both came from real runs. Unavailable arms
// produce no trial.

function providerNames() {
  const primary = (process.env.AI_PRIMARY_PROVIDER || '').trim().toLowerCase();
  const fallbacks = (process.env.AI_FALLBACK_PROVIDERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const names = [];
  for (const name of [primary, ...fallbacks]) {
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function providerConfig(name) {
  const up = name.toUpperCase();
  const baseUrl = process.env[`${up}_BASE_URL`];
  const key = process.env[`${up}_API_KEY`];
  const model = process.env[`${up}_MODEL`];
  if (baseUrl && key && model) return { name, baseUrl, key, model };
  return null;
}

// Ordered list of fully configured providers. A partially configured
// provider (missing base URL, key, or model) is skipped, never attempted.
export function configuredProviders() {
  const chain = providerNames().map(providerConfig).filter(Boolean);
  if (chain.length > 0) return chain;
  if (process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL) {
    return [{
      name: 'legacy',
      baseUrl: process.env.LLM_BASE_URL,
      key: process.env.LLM_API_KEY,
      model: process.env.LLM_MODEL,
    }];
  }
  return [];
}

export function llmConfigured() {
  return configuredProviders().length > 0;
}

async function tryProvider({ provider, messages, timeoutMs, fetchImpl }) {
  const url = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: provider.model, messages }),
      signal: controller.signal,
    });
    if (!res.ok) return { status: 'error', reason: `${provider.name} returned ${res.status}` };
    const body = await res.json().catch(() => null);
    const text = body?.choices?.[0]?.message?.content;
    if (!text) return { status: 'error', reason: `${provider.name} returned no content` };
    return { status: 'ok', text: String(text), provider: provider.name };
  } catch (e) {
    return { status: 'error', reason: `${provider.name} call failed: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function callLlm({ messages, timeoutMs = 25000, fetchImpl = fetch }) {
  const providers = configuredProviders();
  const failures = [];
  for (const provider of providers) {
    const out = await tryProvider({ provider, messages, timeoutMs, fetchImpl });
    if (out.status === 'ok') return out;
    failures.push(out.reason);
  }
  const attempted = providers.map((p) => p.name).join(', ');
  return {
    status: 'unavailable',
    reason: `All LLM providers failed (${attempted}); last failure: ${failures[failures.length - 1] || 'none attempted'}`,
  };
}

export async function runGutArm({ question, fetchImpl = fetch }) {
  if (!llmConfigured()) {
    return { arm: 'gut', status: 'unavailable', reason: 'LLM arm not configured — no pick rendered' };
  }
  const out = await callLlm({
    messages: [{ role: 'user', content: `Pick ONE opening act for this live-show question. Use only your own knowledge, no external data. Question: ${question}` }],
    fetchImpl,
  });
  if (out.status !== 'ok') return { arm: 'gut', status: 'unavailable', reason: out.reason };
  return { arm: 'gut', status: 'ok', pick: out.text, provider: out.provider };
}

export async function runWebArm({ question, webFacts, fetchImpl = fetch }) {
  if (!llmConfigured()) {
    return { arm: 'web', status: 'unavailable', reason: 'LLM arm not configured — no pick rendered' };
  }
  const facts = (webFacts || []).map((f) => `- ${f}`).join('\n') || '(no Wikidata facts available)';
  const out = await callLlm({
    messages: [{ role: 'user', content: `Pick ONE opening act for this live-show question using ONLY the Wikidata facts below (no Qloo taste data). Question: ${question}\nFacts:\n${facts}` }],
    fetchImpl,
  });
  if (out.status !== 'ok') return { arm: 'web', status: 'unavailable', reason: out.reason };
  return { arm: 'web', status: 'ok', pick: out.text, provider: out.provider };
}

// Build a miss-ledger trial from real runs only. Returns null when no comparison
// pick exists (no trial is fabricated from unavailable arms).
export function buildMissTrial({ question, graphPick, gutPick, webPick }) {
  if (!graphPick) return null;
  if (!gutPick && !webPick) return null;
  const misses = [];
  if (gutPick && gutPick !== graphPick) misses.push({ arm: 'gut', pick: gutPick, graphPick });
  if (webPick && webPick !== graphPick) misses.push({ arm: 'web', pick: webPick, graphPick });
  return {
    question,
    graphPick,
    gutPick: gutPick ?? null,
    webPick: webPick ?? null,
    misses,
    recordedAt: new Date().toISOString(),
  };
}
