# OfferSheet — check a live-show offer before you sign it

An independent promoter enters an offer (artist, room, guarantee) and gets,
on one page, no sign-in (design target: about 30 seconds — the timed
end-to-end run on the deployed demo is PARTIAL (26–40s observed;
the ≤30s bar is met sometimes, not always, see §8 T15): the break-even ticket count plus
whether the room's taste audience will show up — with a receipt on every
claim, a Gut-vs-Graph verdict, and a fail-closed guarantee (no key means a
visible 503, never a mock).

## 1. Problem statement

A promoter signing a show guarantee takes the downside: if the room doesn't
fill, the promoter eats it. OfferSheet answers the signing question with
numbers before the signature — break-even tickets from the guarantee and the
ticket economics, checked against live Qloo taste evidence for the headliner,
the opener shortlist, and the city audience.

Undercard ranks openers for a show. OfferSheet answers whether to sign the guarantee at all — a ticket count, not a ranking.

OfferSheet is a free demo with no sign-in: an independent promoter pastes an artist, a city, and a guarantee, and gets the ticket count that must sell before the guarantee pays for itself. After a verdict, the promoter's next step is their own: verify the room size where capacity is unknown, then sign or walk away on the number.

## 2. How it works

Run path: `POST /api/verdict` → MCP chain (10 tools wired; live verification pending — see §8) → REST receipt
legs → Ticketmaster / OpenStreetMap / Wikidata legs → break-even calculator
→ one-page card. The frontend never calls Qloo directly; the Node backend
runs `qloo mcp` over stdio and the REST receipt layer, same-origin only.

Break-even definition: `tickets = ceil(guarantee ÷ (ticket price − variable
cost per ticket))`. If break-even exceeds a known capacity, the verdict is
"Cannot break even in this room at this guarantee."

## 3. Qloo tools and workflows — and why they fit

All 10 MCP tools are wired (wired, not yet all live-verified — see §8):

| Tool | OfferSheet use |
|---|---|
| `qloo_capabilities` | Readiness gate + health check. The "Qloo live" badge turns green only after a live call succeeds, never from config alone. |
| `qloo_find_tags` | Tag-first path: the headliner is resolved to tags before any audience call. Unresolved input is shown as unmeasured and excluded, never guessed. |
| `qloo_describe` | Headliner + opener cards. An ambiguous name returns `needs_input` candidates the user picks — the verdict never guesses. |
| `qloo_recommend` | Opener candidates from fans of the headliner (`target_type=artist`). |
| `qloo_rank` | The opener shortlist ranked for the city audience. |
| `qloo_where_popular` | Routing + city-audience evidence (matched areas, not a headcount). |
| `qloo_compare_audiences` | Headliner-vs-opener audience overlap. |
| `qloo_audience_demographics` | Full age/gender bands for the headliner audience. |
| `qloo_entity_tags` | Top shared-tags evidence between headliner and opener. |
| `qloo_trends` | 90-day momentum leg (optional evidence; its failure never withholds a verdict). |

REST receipt layer (cross-checks the MCP legs): `/search` (name resolution),
`/v2/insights` (tags + `feature.explainability=true`), `/v2/analysis/compare`
(headliner vs opener overlap), `/entities` (max 15 per call). Every claim
carries a SHA-256 request hash, the response requestId (null when the
upstream returns none — never invented), and a resultCount. Every receipt in
a verdict response carries replay data: click it to re-run the exact call via
`POST /api/replay` and compare. MCP receipts carry an argument hash (hashKind 'args', no upstream requestId); REST receipts carry a request-URL hash (hashKind 'url'). MCP receipts are labeled 'argument hash, no upstream requestId' so they are never confused with REST request-URL hashes.

## 4. Request-to-result (redacted)

Input is artist + city + guarantee (plus optional room/venue, ticket price, variable cost per ticket, and capacity). No names, emails, device IDs, account IDs, or location histories
are sent to Qloo — ever. Entity/tag choices: the headliner name is resolved
through `find_tags` first, then `describe`; when several entities match, the
user picks from candidates. Tag URNs from `find_tags` feed the REST insights
leg; when no tag URNs resolve, that leg is skipped and labeled, not faked.
Qloo results describe aggregate affinities only: the card reports matched
areas/entities and counts with receipts, never an individual prediction,
never a causal claim, and never a population headcount (Qloo returns none).

## 5. Demo

The deployed demo URL is pending (see §9 — push is done, no deploy has
happened yet). No screenshots are included here: none have been captured from a
deployed demo, and none are fabricated. The frontend in this repo is the
full Studio design system (light studio-white proof paper, ink dot grid,
blue-black ink, Hedvig Letters Serif heads, crop marks, cadmium-orange
construction guides + the one primary action): compact wound line + form
first, verdict card as page hero, hero figure collapsible below the
verdict, spec-honest stats strip (tools wired, not all live-verified;
receipts on Qloo claims; 3 arms wired — 3 live trials recorded 29 Oct 2026), race as a
secondary toggle below the verdict (live three-arm runs recorded 29 Oct 2026, see
§8 T07), receipt drawer with replay, formula panel, safety strip, and
benchmark ledger — with designed loading, empty, error,
unknown-capacity, and verdict-withheld states. The capacity box renders
the backend's per-cause message verbatim (not-configured, Ticketmaster
error, or no capacity in the fetched record). Custom images (hero +
4 3D icons) are real files under `frontend/assets/`, generated via the
media pipeline (never stock, never Hallmark pictures), referenced by
relative paths and verified byte-identical when served.

## 6. Setup from a clean environment

Requirements: Node ≥ 22.19, no dependencies (`npm install` installs nothing).

```text
node backend/server.js        # serves the frontend + /api/* on $PORT (default 3000)
npm test                      # node:test suite, zero dependencies
```

Environment variables (server only, never in a client bundle, never in the
repo):

| Variable | Purpose |
|---|---|
| `QLOO_API_KEY` | Event-issued hackathon key. Required for any live Qloo call. |
| `TICKETMASTER_API_KEY` | Discovery API key. Gates the capacity leg only; its absence yields the "unknown capacity" state, never a failure. |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | Optional LLM provider (OpenAI-compatible chat completions) for the Gut and Web arms. When unset, both arms report `unavailable` and render that state — never a fabricated pick. |
| `MONTHLY_CALL_BUDGET` / `PER_VISITOR_DAILY_CAP` / `PER_RUN_CALL_CAP` | Adopted design settings (defaults 1500 / 20 / 40). These are this product's own guards, NOT Qloo-stated quotas — no numeric Qloo quota is documented anywhere. |

## 7. Known limitations — what results do NOT establish

- Qloo affinities are aggregate taste signals, not a promise that a show will
  sell out. No sellout percentage (likelihood of selling out) is ever rendered; when capacity is known, only the break-even share of seats is shown, labeled 'not a sellout prediction'.
- Audience size is matched areas/entities with receipts, never a headcount.
- Capacity: the Madison Square Garden venue record (real response,
  2026-10-29) carries NO capacity field, so that room renders "unknown
  capacity" — the correct behavior, not a failure. A room entered in the Room / venue field that Ticketmaster's venue search resolves renders its capacity labeled "Ticketmaster-reported", and its events' prices ground the verdict. With no venue entered, or when the named room does not resolve, capacity and price come from the first matching Ticketmaster event and render labeled "first matching Ticketmaster event's venue, not the offer room" — never silently as the offer room's numbers.
  A user-supplied capacity renders labeled "user-supplied, not
  Ticketmaster-verified".
- Variable cost per ticket is optional. When left blank, net renders as "before variable costs" — never as if costs were zero. An explicitly entered 0 renders as cost 0.
- The Web arm is LLM + Wikidata facts only — no generic web search is called. OpenStreetMap output is display-only (shown for confirmation, never fed into Qloo filters) and Wikidata output is input to the Web arm only, never a direct verdict input.
- Guards are per-instance tripwires, not a quota guarantee: in-memory, per-instance counters reset on restart and do not cap total usage across instances or restarts.
- No server-side cache; every verdict re-runs live legs.
- Quota guards are in-memory counters (they reset on restart); persistent
  counters are a documented deploy-time improvement, not a claimed feature.
- REST response field names for requestId/entity IDs are parsed defensively:
  the guide renders no full example JSON, so an unparseable leg is labeled,
  never guessed. These shapes are TO-VERIFY against live responses after
  deploy.
- Ticketmaster capacity-field presence varies by venue and is unproven beyond
  the Madison Square Garden response above.
- The LLM provider shape is OpenAI-compatible chat completions via env, as a
  fallback chain: `AI_PRIMARY_PROVIDER` + `AI_FALLBACK_PROVIDERS`
  (comma-separated), each provider configured via
  `<UPPER_NAME>_BASE_URL` / `<UPPER_NAME>_API_KEY` / `<UPPER_NAME>_MODEL`
  (legacy `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` still works as a
  single provider). Providers are tried in order; if all fail, the arms
  render `unavailable`, never a fabricated pick. The answering provider
  is named on each arm result.

## 8. Test ledger — final green run, 2026-10-29

`npm test` from the repo root: **197 tests, 197 pass, 0 fail** — unit/stub/staging tests only; live rows T05/T07 are live, T15 PARTIAL, and T06/T08 PARTIAL (see table)
(full output: `test/ledger/FINAL-RUN.txt`; red→green process evidence:
`test/ledger/T09-red.txt`, `test/ledger/T09-green.txt`). Counts come only
from this green run. Any row without a passing run is UNCOVERED, never
claimed.

| Row | What it covers | Result |
|---|---|---|
| T01 break-even arithmetic (unit) | ceil, zero guarantee, zero/negative net, over-capacity, missing price | GREEN, 8/8 |
| T02 receipt-hash determinism (unit) | SHA-256 stability, manifest shape, null requestId never invented | GREEN, 4/4 |
| T03 quota-guard logic (unit) | per-run cap + reset, rollover, snapshot | GREEN, 3/3 in guards file (2 more under T12/T13) |
| T04 fail-closed mapping (unit) | NOT_CONFIGURED/QLOO_AUTH 503, visitor 429, envelope mapping | GREEN, 2/2 |
| T05 MCP chain live (all 10 tools) | 10/10 MCP tools invoked live; 8/10 receipted (trends + compare_audiences wired, empty on live runs so far, shown as no data) | LIVE |
| T06 REST receipt leg live | search live 200; restSearch + restEntities receipted live in trial 1; REST 429s on back-to-back runs (exact failure labels) | PARTIAL |
| T07 three-arm run live | 3 bench trials recorded 2026-10-29 (Qwen primary, Groq fallback proven live) + browser-judge runs with all 3 lanes + miss ledger | LIVE |
| T08 receipt replay live | Live-proven: replay MATCH same IDs in same order (10 results), plus a "not comparable" case when no ID list exists | PARTIAL |
| T09 red→green regression (process) | Red run (missing module) + green run on disk | EVIDENCED |
| T10 no-key 503 staging run | Server with no key: health `qlooConfigured: false`, verdict 503 NOT_CONFIGURED, page still serves | GREEN, 1/1 |
| T11 missing-capacity state | Pure extraction + pipeline: unknown state with exact wording, no sellout fields; user/TM capacity labeling; price_unknown | GREEN, 5/5 |
| T12 quota-floor trip (staging) | Monthly budget trip → QUOTA_FLOOR 503; month rollover resets | GREEN, 2/2 |
| T13 per-visitor cap (staging) | Per-IP daily cap → VISITOR_CAP 429; other IPs unaffected | GREEN, 1/1 |
| T14 retry/backoff (local stub) | 429→200 after exactly 2 requests; always-500 after exactly 2; timeout → throw after 2 | GREEN, 3/3 |
| T15 E2E judge path ≤30s on deployed demo | Ran on the deployed demo; times 26–40s (in-page race timer 34,856ms on one run); the ≤30s bar is met sometimes, NOT always | PARTIAL |
| T16 no-mock static audit | No fixture imports, no mock/fake/stub identifiers outside strings/comments, NOT_CONFIGURED + verdict_withheld present, no literal key assignment | GREEN, 4/4 (see note) |
| S1 verdict gating | Full evidence → verdict + receipts + miss trial; no key → NOT_CONFIGURED; required-leg failure → WITHHELD with no numbers; optional-leg failure → verdict still renders; ambiguous headliner → needs_input | GREEN, 6/6 |
| D1 break-even edges | Huge guarantee 10^12 (exact ceil), zero/negative/non-numeric price, negative variable cost, non-numeric guarantee, capacity-equality boundary, null-capacity canBreakEven | GREEN, 11/11 |
| D2 input validation | Missing/whitespace-only/non-string artist + city → INVALID_INPUT 400; zero/negative capacity → unknown; pipeline-level over-capacity verdict; trimmed input; empty-candidate needs_input | GREEN, 13/13 |
| D3 retry exact counts (local stub) | 200/400/401/404 → exactly 1 request; 429/5xx → exactly 2 (one retry); Retry-After 1s honored, 30s capped at 10s; fetch-error retry vs non-fetch no-retry; key in header only; requestId from body/snake_case/header, null when absent | GREEN, 16/16 |
| D4 degradation legs | Ticketmaster throw/500 → verdict + unknown capacity, no invention; OSM throw/unavailable/empty → city as typed, omission disclosed; Wikidata throw/500 → leg omitted, verdict + miss trial survive; stub-level geocode (incl. 1 req/sec gap), Wikidata, Ticketmaster clients | GREEN, 14/14 |
| D5 quota exact thresholds | Monthly/visitor/per-run caps allow exactly N, trip on N+1 (codes + statuses); budget-0; month rollover re-trips; stale-day visitor isolation; pipeline RUN_CAP/QUOTA_FLOOR incl. late-leg trips (see fix note) | GREEN, 11/11 |
| D6 verdict-gating matrix | Each required leg failing alone withholds with NO verdict-number fields; all-5-missing case; OR-survivors (single paired-leg failure) still render; needs_input returns before any ranking call | GREEN, 14/14 |
| D7 unknown-capacity extended | ZERO sellout/room-fill/percentage keys and no `%` char in the unknown-capacity response; user capacity beats Ticketmaster capacity; extraction rejects 0/NaN/Infinity/string | GREEN, 6/6 |
| D8 receipt replay | Every verdict receipt's replay payload reproduces its original call; local-stub re-run match (same IDs/order) + mismatch paths (changed IDs, changed count); no-key replay → 503 NOT_CONFIGURED | GREEN, 5/5 |
| D9 badge rule | Health never claims live/green/badge state; capabilities-probe-alone yields WITHHELD, never a verdict; no-key run makes zero live calls | GREEN, 4/4 |
| D10 no-mock audit extended | T16 gap closed: backend/server.js scanned with the same rules; scope-completeness tripwire (scanned set must equal the full backend JS tree); server fail-closed wiring present | GREEN, 5/5 |
| QA backend fixes (G5/G6/G7/G8/G10/G13/G16/G17/G18/G24/G42/G47/G4) | Required-leg gating (ok + non-empty), replay allowlist + guards, replay ID/order payload, parallel legs + 90s budget, guard pruning, REST compare/entities wired, empty-entities → empty, MCP hashKind labels, health tools field, per-cause capacity wording, import-graph audit, abort/timeout, MCP shapes verified keyless vs harness 0.1.26 tools/list | GREEN, 23/23 |
| No-mock import-graph audit (G42) | No production backend file imports test/ or fixtures.js | GREEN, 1/1 |
| Money ground truth (G11/G12/G9/G14) | Named-room venue grounding + venueId scoping, blank-vs-zero variable cost, Web arm relabeled LLM + Wikidata facts, OSM display-only + Wikidata Web-arm-only labels | GREEN, 13/13 |
| Server wiring (G11 production) | server.js buildDeps wires tmVenues from searchVenues + Ticketmaster key (static proof; importing server.js would bind a port) | GREEN, 3/3 |

D5 fix note: the D5 pipeline per-run-cap test first ran RED (full run 135/136): a guard trip after the readiness probe was swallowed by the leg try/catch blocks and downgraded to a 200 `verdict_withheld`, losing the guard's 503 code. Fixed surgically in `backend/src/errors.js` (`isGuardTrip`) + `backend/src/pipeline.js` (trips recorded in the call/rest wrappers, rethrown before the verdict gate; no live call is made after a trip). Two late-leg regression tests (trip on the 6th call, RUN_CAP + QUOTA_FLOOR) were added with the fix; the final run is green (see header count).

T16 note: the audit is a tripwire, not proof — T10 is the behavioral
guarantee. During this build the audit's first version failed on its own
over-broad pattern (it matched the word "fixtures" in a documentation
comment); the test was narrowed to import statements and the re-run is
green. The failure and the fix are recorded here, not hidden.

Supporting live evidence (not test rows): `test/ledger/LIVE-CHECKS.md`
(Qloo search ×2, Ticketmaster venues, capacity-field probe, MCP capabilities
without a key, OSM geocode, Wikidata search).

MAX+ status: S1 verdict gating DONE (tested). S2 bench ledger: schema +
`/api/bench` endpoint DONE; 3 trials recorded 2026-10-29 in bench/results.json. S3 receipts manifest: repo manifest shape + per-verdict
receipts with replay data DONE; the manifest itself is empty until real
runs are recorded. S4 formula panel DONE (formula + worked example
in real numbers, recomputed from live verdict numbers). S7 live race:
`/api/race` + secondary race toggle with timings + miss ledger DONE in
code; live three-arm runs recorded 29 Oct 2026 (keys present; Qwen primary, Groq fallback proven live). S5 stats
strip, S6 wound-first screen, and S8 safety strip presentation DONE in the
Studio frontend (form-first with wound line, spec-honest stats strip below
the verdict, collapsible hero figure, visible safety strip). Backend static handler
sends raw bytes with image content types (webp/png/jpeg/avif) — a UTF-8
decode of binary assets corrupted them; fixed and verified byte-identical
for all five frontend assets.

## 9. Deployment status (2026-10-29 — LIVE, bundle pending redeploy check)

Settled identities (parent-verified 2026-10-29): GitHub
`mohamedwael201193` (id 72895329); Vercel `mohamedwael201193` (frontend);
Render workspace "Ffcvv's workspace" (user-confirmed, backend).

1. Backend: LIVE — Render service `offersheet-backend`, Starter plan
   (user-authorized $7, NOT free), URL
   `https://offersheet-backend-k2zp.onrender.com`, health check
   `/api/health`. Earlier free-tier creation failed twice (HTTP 400 quota
   exhausted); the user chose Starter instead.
2. Demo: LIVE — Vercel project `offersheet` (Root Directory `frontend`),
   URL `https://offersheet-rouge.vercel.app`. Vercel has NO git
   integration: every redeploy is a manual files-upload API deploy with
   base64 encoding on every file.
3. Env vars on the Render service (verified by API 2026-10-29, names
   only): `QLOO_API_KEY`, `TICKETMASTER_API_KEY`, plus the 7-provider
   LLM chain (`AI_PRIMARY_PROVIDER=qwen`,
   `AI_FALLBACK_PROVIDERS=groq,cerebras,sambanova,together,openrouter,kimi`,
   each with its own base URL / key / model vars). The vault credentials
   that serve Muse's calls do NOT transfer to Render — service values
   come from the user's own copies.
4. This commit bundles: the full Studio landing page, the backend
   REST/ID-threading fixes (Gap 2 + Gap 3) and double-slash guard, and
   the LLM fallback chain. Redeploy verification (health fields, live
   verdict trials, REST/trends/compare receipts, `//` → 400) follows
   the push; results land in `bench/results.json` and
   `test/ledger/LIVE-CHECKS.md`.
5. Post-deploy live checks still to run after this bundle: a timed
   verdict end-to-end (T15, target ≤30s); a receipt replay (T08); a
   benchmark trial recorded in `bench/results.json` (S2).

## 10. Repo state

Local git repo, remote set to `https://github.com/mohamedwael201193/OfferSheet.git`.
Remote `main` was at verified commit `e981641f…` (QA squash, parent-verified
2026-10-29) before this bundle; this bundle was pushed via the GitHub API
on top of that HEAD (see commit history), never by force and never by git
CLI push from the local clone (local history diverges from the remote
squash history; the vault-held token is never revealed to the shell).
No credentials, keys, or tokens appear in code, repo, files, or logs
(verified by T16 and by grep for literal key assignments). License: MIT
(`LICENSE`, visible in the repo root, satisfying the public-repo license
rule).

## 11. What is blocked on each pending item

| Pending item | Blocks |
|---|---|
| Render free-tier quota in the Ffcvv workspace | RESOLVED — user chose the Starter plan ($7) for `offersheet-backend` |
| `QLOO_API_KEY` / `TICKETMASTER_API_KEY` values on the Render service | SET (verified by API 2026-10-29, names only) |
| LLM provider keys | SET — 7-provider chain (Qwen primary + Groq, Cerebras, SambaNova, Together, OpenRouter, Kimi fallbacks); live trials pending redeploy verification |
| Live re-verification after this bundle (REST receipts, trends/compare receipt or `envelopeSummary`, `//` → 400 on Render, timed verdict, replay, bench trial) | Pending the redeploy check in §9.4 |
| Studio frontend implemented 2026-10-29 (no longer gated on a sketch) | — |
