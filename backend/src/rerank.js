// Opener re-rank with exclusion + scored-miss taxonomy (Phase 3, Wave 2).
// Pure functions only: no I/O, no keys, no model call, no invented reason.
// The frontend (frontend/app.js) mirrors classifyMiss/classifyMisses
// exactly; the suite test asserts both implementations agree on the same
// inputs, so a verdict rendered in the browser carries the same codes the
// pipeline attaches server-side.
//
// MISS TAXONOMY — exactly one code per miss, codes sum to the miss count:
//   NOT_IN_RANKED      pick is in the candidate set but not the ranked set
//   NOT_IN_CANDIDATES  pick is in neither set (candidate set present)
//   SAME_AS_HEADLINER  pick names the main artist itself
//   EMPTY_OR_UNRESOLVED pick is empty, whitespace-only, or "unresolved"
//   UNCLASSIFIED       reason not derivable from this run
// Data-honesty rule: when no candidate/ranked set was recorded for the
// trial (the recorded trials carry neither set), EVERY miss is
// UNCLASSIFIED with the detail "candidate set not recorded for this
// trial" — never guessed from the pick text, even when the pick text
// happens to name the headliner. Set-membership codes require a set.
// Precedence on a live run (sets recorded): empty -> same-as-headliner
// -> not-in-candidates -> not-in-ranked -> in-ranked-but-not-top (which
// has no more specific code, so it is UNCLASSIFIED with that detail).
// A pick in the ranked set that merely differs from the top pick is NOT
// forced into NOT_IN_RANKED: it is in the set, so that code would be false.

export const MISS_CODES = {
  NOT_IN_RANKED: 'NOT_IN_RANKED',
  NOT_IN_CANDIDATES: 'NOT_IN_CANDIDATES',
  SAME_AS_HEADLINER: 'SAME_AS_HEADLINER',
  EMPTY_OR_UNRESOLVED: 'EMPTY_OR_UNRESOLVED',
  UNCLASSIFIED: 'UNCLASSIFIED',
};

export const MISS_CODE_LABELS = {
  NOT_IN_RANKED: 'pick not in the ranked set',
  NOT_IN_CANDIDATES: 'pick not in the candidate set',
  SAME_AS_HEADLINER: 'pick identical to the main artist',
  EMPTY_OR_UNRESOLVED: 'pick empty or unresolved',
  UNCLASSIFIED: 'unclassified — reason not derivable from this run',
};

export const UNRECORDED_SET_DETAIL = 'candidate set not recorded for this trial';

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

// Name match on the pick's LEAD name, not on any substring: picks are
// often sentences ("Clairo. Her ...", "Armani White — the only ..."), and
// the explanatory prose may mention the headliner or other acts — a
// substring match would misread prose as the pick. The lead is the text
// before the first sentence break (. — newline :); a lead that begins
// with the name (or equals it) is the pick naming that artist.
export function pickLead(pick) {
  const t = String(pick ?? '').trim();
  let end = t.length;
  for (const sep of ['.', '—', '\n', ':']) {
    const i = t.indexOf(sep);
    if (i > 0 && i < end) end = i;
  }
  const lead = t.slice(0, end).trim();
  return lead || t;
}
export function pickMatchesName(pick, name) {
  const p = norm(pickLead(pick));
  const n = norm(name);
  if (!p || !n) return false;
  return p === n || p.startsWith(n + ' ') || n.startsWith(p + ' ');
}

function namesOfSet(list) {
  if (!Array.isArray(list)) return [];
  return list.map((it) => (it && typeof it === 'object' ? (it.name ?? it.id ?? null) : it))
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
}

export function classifyMiss(miss, ctx = {}) {
  const pick = miss?.pick ?? null;
  const graphPick = miss?.graphPick ?? ctx.graphPick ?? null;
  const ranked = namesOfSet(ctx.ranked);
  const candidates = namesOfSet(ctx.candidates);
  const setsRecorded = ctx.setsRecorded === undefined
    ? (ranked.length > 0 || candidates.length > 0)
    : ctx.setsRecorded === true;
  if (!setsRecorded) {
    return { code: MISS_CODES.UNCLASSIFIED, label: MISS_CODE_LABELS.UNCLASSIFIED, detail: UNRECORDED_SET_DETAIL };
  }
  const pickText = typeof pick === 'string' ? pick.trim() : '';
  if (pickText === '' || norm(pickText) === 'unresolved') {
    return { code: MISS_CODES.EMPTY_OR_UNRESOLVED, label: MISS_CODE_LABELS.EMPTY_OR_UNRESOLVED, detail: 'pick empty or unresolved this run' };
  }
  const artist = ctx.artist ?? null;
  if (artist && pickMatchesName(pickText, artist)) {
    return { code: MISS_CODES.SAME_AS_HEADLINER, label: MISS_CODE_LABELS.SAME_AS_HEADLINER, detail: 'pick names the main artist itself' };
  }
  const inCandidates = candidates.length > 0 && candidates.some((c) => pickMatchesName(pickText, c));
  const inRanked = ranked.length > 0 && ranked.some((r) => pickMatchesName(pickText, r));
  if (candidates.length > 0 && !inCandidates) {
    return { code: MISS_CODES.NOT_IN_CANDIDATES, label: MISS_CODE_LABELS.NOT_IN_CANDIDATES, detail: 'pick appears in neither the candidate set nor the ranked set' };
  }
  if (ranked.length > 0 && !inRanked) {
    return { code: MISS_CODES.NOT_IN_RANKED, label: MISS_CODE_LABELS.NOT_IN_RANKED, detail: 'pick is in the candidate set but not the ranked set' };
  }
  if (ranked.length === 0 && candidates.length === 0) {
    return { code: MISS_CODES.UNCLASSIFIED, label: MISS_CODE_LABELS.UNCLASSIFIED, detail: 'no candidate or ranked set recorded for this run' };
  }
  // In a set but not the top pick (or equal to the graph pick, which
  // cannot happen for a miss): no more specific code applies.
  return { code: MISS_CODES.UNCLASSIFIED, label: MISS_CODE_LABELS.UNCLASSIFIED, detail: 'pick is in the ranked set but is not the top pick — no more specific code applies' };
}

export function classifyMisses(misses, ctx = {}) {
  const list = Array.isArray(misses) ? misses : [];
  const coded = list.map((m) => ({ ...m, ...classifyMiss(m, ctx) }));
  const counts = {};
  for (const c of coded) counts[c.code] = (counts[c.code] || 0) + 1;
  return { misses: coded, counts, total: coded.length };
}

// Re-rank arguments: the same candidate set minus the excluded (top)
// pick, in original order. Options carry IDs when present, else names —
// exactly the shape the pipeline's rank leg sends. Throws a plain Error
// with a display-safe message; the server maps it to INVALID_INPUT.
export function buildRerankArgs({ artist, city, candidates, ranked, excludedPick, headlinerId }) {
  const base = Array.isArray(ranked) && ranked.length > 0 ? ranked : (candidates || []);
  const items = base.map((it) => (it && typeof it === 'object' ? { id: it.id ?? null, name: it.name ?? null } : { id: null, name: it }));
  const remaining = items.filter((it) => {
    if (excludedPick && it.id && typeof excludedPick === 'object' && excludedPick.id) return String(it.id) !== String(excludedPick.id);
    const exName = typeof excludedPick === 'string' ? excludedPick : (excludedPick?.name ?? null);
    if (exName && it.name && pickMatchesName(exName, it.name)) return false;
    if (exName && it.id && pickMatchesName(exName, it.id)) return false;
    return true;
  });
  const excludedFound = remaining.length !== items.length;
  if (!excludedFound) throw new Error('excluded pick is not in the candidate set — nothing to exclude');
  if (remaining.length === 0) throw new Error('no candidates remain after exclusion — re-rank cannot run');
  const options = remaining.map((it) => it.id || it.name).filter(Boolean);
  if (options.length === 0) throw new Error('no candidates remain after exclusion — re-rank cannot run');
  return {
    options,
    option_type: 'artist',
    signals: [headlinerId || artist].filter(Boolean),
    signal_location: city,
    remaining,
  };
}

// Shape a live qloo_rank envelope into the re-rank result. An ok-but-empty
// envelope, or any non-ok status, yields status 'empty'/'error' with an
// exact label and NO pick — the frontend renders the label and no number.
export function formatRerankResult(envelope, { excludedPick, receipt }) {
  const results = Array.isArray(envelope?.results) ? envelope.results : [];
  if (envelope?.status === 'ok' && results.length > 0) {
    const first = results[0];
    return {
      status: 'ok',
      excludedPick: typeof excludedPick === 'string' ? excludedPick : (excludedPick?.name ?? null),
      newPick: { id: first.entity_id ?? first.id ?? first.uuid ?? null, name: first.name ?? first.properties?.name ?? null },
      ranked: results.map((r) => ({ id: r.entity_id ?? r.id ?? r.uuid ?? null, name: r.name ?? r.properties?.name ?? null })),
      receipt: receipt || null,
    };
  }
  if (envelope?.status === 'ok') {
    return { status: 'empty', label: 'no data for this entity/region', excludedPick: typeof excludedPick === 'string' ? excludedPick : (excludedPick?.name ?? null), newPick: null, receipt: receipt || null };
  }
  return { status: 'error', label: `Qloo returned status ${envelope?.status || 'unknown'}`, excludedPick: typeof excludedPick === 'string' ? excludedPick : (excludedPick?.name ?? null), newPick: null, receipt: receipt || null };
}
