// Error taxonomy for the verdict path. Every failure maps to a visible state —
// never to invented data. HTTP codes: 503 = fail-closed states, 429 = visitor cap,
// 400 = invalid input, 502 = upstream failure surfaced as section-incomplete.
export class OfferError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const notConfigured = () => new OfferError(
  'NOT_CONFIGURED',
  503,
  'Qloo is not configured for this demo. No verdict can be computed without live Qloo data.',
);

export const qlooAuthFailed = () => new OfferError(
  'QLOO_AUTH',
  503,
  'Qloo authentication failed. No verdict can be computed without live Qloo data.',
);

export const quotaFloorTripped = () => new OfferError(
  'QUOTA_FLOOR',
  503,
  'Qloo live quota floor reached — live calls paused. No verdict numbers are shown in this state.',
);

export const visitorCapTripped = () => new OfferError(
  'VISITOR_CAP',
  429,
  'Per-visitor daily cap reached. Try again tomorrow; no stale or invented data is served.',
);

export const runCapTripped = () => new OfferError(
  'RUN_CAP',
  503,
  'Per-run call cap reached. The verdict run was stopped rather than completed on partial evidence.',
);

export const invalidInput = (message) => new OfferError('INVALID_INPUT', 400, message);

// Map a Qloo MCP envelope error to an OfferError. Retry only when retryable=true
// (official envelope rule); a non-retryable error is a section-incomplete state.
export function mapEnvelopeError(envelope) {
  const code = envelope?.error?.code || 'QLOO_ERROR';
  if (code === 'QLOO_AUTH') return qlooAuthFailed();
  return new OfferError(code, 502, `Qloo evidence unavailable: ${code}. Verdict incomplete.`);
}
