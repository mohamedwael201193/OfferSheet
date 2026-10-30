// Configuration — environment variables ONLY. No key, token, or secret is ever
// hard-coded, logged, or shipped in a client bundle.
// QLOO_API_KEY: event-issued hackathon key, set as a server secret (Render env var).
// TICKETMASTER_API_KEY: self-serve Discovery API key, server secret only.
// Adopted design settings below are NOT Qloo-stated values: no numeric Qloo quota
// exists anywhere in the guide. They are this product's own guards, labeled as such.
function numEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  qlooBaseUrl: process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com',
  qlooKey: process.env.QLOO_API_KEY || '',
  qlooKeyConfigured: Boolean(process.env.QLOO_API_KEY),
  qlooMcpCommand: process.env.QLOO_MCP_COMMAND || 'qloo',
  ticketmasterKey: process.env.TICKETMASTER_API_KEY || '',
  tmKeyConfigured: Boolean(process.env.TICKETMASTER_API_KEY),
  ticketmasterBaseUrl: 'https://app.ticketmaster.com/discovery/v2',
  osmBaseUrl: 'https://nominatim.openstreetmap.org',
  wikidataBaseUrl: 'https://www.wikidata.org/w/api.php',
  // Adopted design settings (NOT Qloo quotas):
  monthlyCallBudget: numEnv('MONTHLY_CALL_BUDGET', 1500),
  perVisitorDailyCap: numEnv('PER_VISITOR_DAILY_CAP', 20),
  perRunCallCap: numEnv('PER_RUN_CALL_CAP', 40),
  restTimeoutMs: 25000,
  mcpTimeoutMs: 60000,
  // Overall verdict budget (G8/G47): a run that exceeds this ends withheld
  // with a disclosed timeout — never a partial verdict presented as complete.
  verdictBudgetMs: numEnv('VERDICT_BUDGET_MS', 90000),
};
