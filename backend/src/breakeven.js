// Break-even arithmetic (pure, no network).
// Blank stack: tickets = ceil(guarantee / net), net = ticket price - variable
// cost per ticket. An entered fixed-cost stack changes the numerator only:
// tickets = ceil((guarantee + entered fixed costs - entered sponsor offset) / net).
// A field that is omitted, undefined, or null is blank: it is left out of the
// sum and is never treated as zero. An explicit 0 is entered zero.
// No tax rate, fee rate, or other number is assumed.
// Edges: zero/negative net -> error (never division by zero); guarantee 0 with
// every fixed-cost field blank -> 0 tickets with a note; total to recover
// <= 0 once any fixed-cost field is entered -> error ("total fixed must stay
// > 0"); missing price -> error (no invented number); break-even exceeding
// known capacity -> "Cannot break even in this room at this guarantee".

export const FIXED_COST_FIELDS = [
  { key: 'roomCost', label: 'venue cost' },
  { key: 'productionCost', label: 'production cost' },
  { key: 'marketingCost', label: 'marketing cost' },
  { key: 'otherFixedCosts', label: 'other fixed costs' },
];

export const SPONSOR_OFFSET_FIELD = { key: 'sponsorOffset', label: 'sponsor offset' };

function readMoney(label, value) {
  if (value === undefined || value === null) return { entered: false, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be >= 0`);
  }
  return { entered: true, value };
}

// Normalize the optional stack. Blank fields stay entered:false and add nothing.
export function fixedStack(source = {}) {
  const lines = {};
  let sum = 0;
  let anyEntered = false;
  for (const { key, label } of FIXED_COST_FIELDS) {
    const line = readMoney(label, source[key]);
    lines[key] = line;
    if (line.entered) {
      sum += line.value;
      anyEntered = true;
    }
  }
  const sponsorOffset = readMoney(SPONSOR_OFFSET_FIELD.label, source[SPONSOR_OFFSET_FIELD.key]);
  let offsetAmount = 0;
  if (sponsorOffset.entered) {
    offsetAmount = sponsorOffset.value;
    anyEntered = true;
  }
  return { lines, sponsorOffset, sum, offsetAmount, anyEntered };
}

// Only the numbers that were actually entered, for callers that spread args.
export function enteredFixedArgs(source) {
  const stack = fixedStack(source || {});
  const out = {};
  for (const { key } of FIXED_COST_FIELDS) {
    if (stack.lines[key].entered) out[key] = stack.lines[key].value;
  }
  if (stack.sponsorOffset.entered) out.sponsorOffset = stack.sponsorOffset.value;
  return out;
}

// Guarantee plus entered fixed costs, minus an entered sponsor offset.
// Blank fields contribute nothing. Throws on a non-number or a negative.
export function recoverTotal(guarantee, source) {
  const stack = fixedStack(source || {});
  return guarantee + stack.sum - stack.offsetAmount;
}

export function breakEven({
  guarantee,
  ticketPrice,
  variableCost = 0,
  capacity = null,
  roomCost,
  productionCost,
  marketingCost,
  otherFixedCosts,
  sponsorOffset,
} = {}) {
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
  const stack = fixedStack({ roomCost, productionCost, marketingCost, otherFixedCosts, sponsorOffset });
  const net = ticketPrice - cost;
  if (net <= 0) {
    throw new Error('net per-ticket contribution must be positive');
  }
  // Historical blank path: guarantee 0 and no fixed-cost field entered.
  // The return object stays the pre-stack shape — no fixedCosts key.
  if (guarantee === 0 && !stack.anyEntered) {
    return { tickets: 0, note: 'no guarantee', verdict: null, net, capacity, variableCost: cost };
  }
  const totalToRecover = guarantee + stack.sum - stack.offsetAmount;
  if (!(totalToRecover > 0)) {
    throw new Error('total fixed must stay > 0');
  }
  const tickets = Math.ceil(totalToRecover / net);
  const verdict = (capacity !== null && capacity !== undefined && tickets > capacity)
    ? 'Cannot break even in this room at this guarantee'
    : null;
  // G12: the cost actually subtracted is echoed so callers can render it —
  // the pipeline separately records whether the promoter entered one at all
  // (blank must never render as if costs were zero).
  const result = { tickets, note: null, verdict, net, capacity, variableCost: cost };
  // Blank stack: omit fixedCosts so the object matches the pre-stack result.
  if (!stack.anyEntered) return result;
  result.fixedCosts = {
    roomCost: stack.lines.roomCost,
    productionCost: stack.lines.productionCost,
    marketingCost: stack.lines.marketingCost,
    otherFixedCosts: stack.lines.otherFixedCosts,
    sponsorOffset: stack.sponsorOffset,
    totalToRecover,
  };
  return result;
}

export function canBreakEven(result, capacity) {
  if (capacity === null || capacity === undefined) return null;
  return result.tickets <= capacity;
}
