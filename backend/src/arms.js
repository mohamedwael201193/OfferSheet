// Gut arm (LLM alone) and Web arm (LLM + generic web data) — the two comparison
// arms beside the Qloo-grounded Graph arm.
// Provider rule: the LLM provider is pluggable via environment ONLY
// (LLM_BASE_URL + LLM_API_KEY + LLM_MODEL, OpenAI-compatible chat-completions
// shape — the exact provider is TO-VERIFY at deploy time). When unconfigured,
// both arms return status 'unavailable' and the panel renders that state —
// NEVER a fabricated pick. A pick is only ever a real model output.
// Miss-ledger rule: a ledger trial exists ONLY when the Graph pick and at least
// one comparison pick both came from real runs. Unavailable arms produce no trial.
export function llmConfigured() {
  return Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL);
}

async function callLlm({ messages, timeoutMs = 25000, fetchImpl = fetch }) {
  const baseUrl = process.env.LLM_BASE_URL;
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages }),
    });
    if (!res.ok) return { status: 'error', reason: `LLM provider returned ${res.status}` };
    const body = await res.json().catch(() => null);
    const text = body?.choices?.[0]?.message?.content;
    if (!text) return { status: 'error', reason: 'LLM provider returned no content' };
    return { status: 'ok', text: String(text) };
  } catch (e) {
    return { status: 'error', reason: `LLM call failed: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function runGutArm({ question, fetchImpl = fetch }) {
  if (!llmConfigured()) {
    return { arm: 'gut', status: 'unavailable', reason: 'LLM arm not configured — no pick rendered' };
  }
  const out = await callLlm({
    messages: [{ role: 'user', content: `Pick ONE opening act for this live-show question. Use only your own knowledge, no external data. Question: ${question}` }],
    fetchImpl,
  });
  if (out.status !== 'ok') return { arm: 'gut', status: 'error', reason: out.reason };
  return { arm: 'gut', status: 'ok', pick: out.text };
}

export async function runWebArm({ question, webFacts, fetchImpl = fetch }) {
  if (!llmConfigured()) {
    return { arm: 'web', status: 'unavailable', reason: 'LLM arm not configured — no pick rendered' };
  }
  const facts = (webFacts || []).map((f) => `- ${f}`).join('\n') || '(no generic web facts available)';
  const out = await callLlm({
    messages: [{ role: 'user', content: `Pick ONE opening act for this live-show question using ONLY the generic web facts below (no Qloo taste data). Question: ${question}\nFacts:\n${facts}` }],
    fetchImpl,
  });
  if (out.status !== 'ok') return { arm: 'web', status: 'error', reason: out.reason };
  return { arm: 'web', status: 'ok', pick: out.text };
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
