// Break-even arithmetic (pure, no network).
// Spec (MAX §2.6): break-even tickets = ceil(guarantee / net per-ticket contribution),
// net = ticket price - variable cost per ticket.
// Edges: zero/negative net -> error (never division by zero); guarantee 0 -> 0 tickets
// with a note; missing price -> error (no invented number); break-even exceeding known
// capacity -> "Cannot break even in this room at this guarantee".
export function breakEven({ guarantee, ticketPrice, variableCost = 0, capacity = null }) {
  if (typeof guarantee !== 'number' || !Number.isFinite(guarantee) || guarantee < 0) {
    throw new Error('guarantee must be >= 0');
  }
  if (ticketPrice === null || ticketPrice === undefined) {
    throw new Error('ticket price is required');
  }
  if (typeof ticketPrice !== 'number' || !Number.isFinite(ticketPrice)) {
    throw new Error('ticket price must be a number');
  }
  const cost = variableCost ?? 0;
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
    throw new Error('variable cost must be >= 0');
  }
  const net = ticketPrice - cost;
  if (net <= 0) {
    throw new Error('net per-ticket contribution must be positive');
  }
  if (guarantee === 0) {
    return { tickets: 0, note: 'no guarantee', verdict: null, net, capacity, variableCost: cost };
  }
  const tickets = Math.ceil(guarantee / net);
  const verdict = (capacity !== null && capacity !== undefined && tickets > capacity)
    ? 'Cannot break even in this room at this guarantee'
    : null;
  // G12: the cost actually subtracted is echoed so callers can render it —
  // the pipeline separately records whether the promoter entered one at all
  // (blank must never render as if costs were zero).
  return { tickets, note: null, verdict, net, capacity, variableCost: cost };
}

export function canBreakEven(result, capacity) {
  if (capacity === null || capacity === undefined) return null;
  return result.tickets <= capacity;
}
