# OfferSheet — check a live-show offer before you sign it

An independent promoter enters an offer (artist, room, guarantee) and gets,
in about 30 seconds, one page, no sign-in: the break-even ticket count plus
whether the room's taste audience will show up — with a receipt on every
claim, a Gut-vs-Graph verdict, and a fail-closed guarantee (no key means a
visible 503, never a mock).

## 1. Problem statement

A promoter signing a show guarantee takes the downside: if the room doesn't
fill, the promoter eats it. OfferSheet answers the signing question with
numbers before the signature — break-even tickets from the guarantee and the
ticket economics, checked against live Qloo taste evidence for the headliner,
the opener shortlist, and the city audience.

## 2. How it works

Run path: `POST /api/verdict` → MCP chain (10 tools, see §3) → REST receipt
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
`POST /api/replay` and compare.

## 4. Request-to-result (redacted)

Input is artist + city + guarantee only (plus optional ticket price and
capacity). No names, emails, device IDs, account IDs, or location histories
are sent to Qloo — ever. Entity/tag choices: the headliner name is resolved
through `find_tags` first, then `describe`; when several entities match, the
user picks from candidates. Tag URNs from `find_tags` feed the REST insights
leg; when no tag URNs resolve, that leg is skipped and labeled, not faked.
Qloo results describe aggregate affinities only: the card reports matched
areas/entities and counts with receipts, never an individual prediction,
never a causal claim, and never a population headcount (Qloo returns none).

## 5. Demo

The deployed demo URL is pending (see §9 — no push or deploy has happened
yet). No screenshots are included here: none have been captured from a
deployed demo, and none are fabricated. The frontend in this repo is the
full Studio design system (light studio-white proof paper, ink dot grid,
blue-black ink, Hedvig Letters Serif heads, crop marks, cadmium-orange
construction guides + the one primary action): wound hero with a custom
hero image, stats strip, verdict tool with the verdict card as page hero,
live Gut-vs-Graph race, receipt drawer with replay, formula panel, safety
strip, and benchmark ledger — with designed loading, empty, error,
unknown-capacity, and verdict-withheld states. Custom images (hero +
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
  sell out. No sellout percentage is ever rendered.
- Audience size is matched areas/entities with receipts, never a headcount.
- Capacity: the Madison Square Garden venue record (real response,
  2026-10-29) carries NO capacity field, so that room renders "unknown
  capacity" — the correct behavior, not a failure. Other venues may report a
  capacity; when one does, it renders labeled "Ticketmaster-reported".
  A user-supplied capacity renders labeled "user-supplied, not
  Ticketmaster-verified".
- Quota guards are in-memory counters (they reset on restart); persistent
  counters are a documented deploy-time improvement, not a claimed feature.
- REST response field names for requestId/entity IDs are parsed defensively:
  the guide renders no full example JSON, so an unparseable leg is labeled,
  never guessed. These shapes are TO-VERIFY against live responses after
  deploy.
- Ticketmaster capacity-field presence varies by venue and is unproven beyond
  the Madison Square Garden response above.
- The LLM provider shape is OpenAI-compatible chat completions via env; the
  exact provider is TO-VERIFY at deploy time.

## 8. Test ledger — final green run, 2026-10-29

`npm test` from the repo root: **39 tests, 39 pass, 0 fail**
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
| T05 MCP chain live (all 10 tools) | Needs the deploy-time Qloo key in the app's environment | UNCOVERED |
| T06 REST receipt leg live | `/search` verified live via the connector (HTTP 200, 5 results); insights/compare/entities need the deploy-time key | PARTIAL |
| T07 three-arm run live | Needs the Qloo key AND an LLM provider key | UNCOVERED |
| T08 receipt replay live | Search-leg replay reproduced (two identical runs, same names/order); full replay needs the deploy-time key | PARTIAL |
| T09 red→green regression (process) | Red run (missing module) + green run on disk | EVIDENCED |
| T10 no-key 503 staging run | Server with no key: health `qlooConfigured: false`, verdict 503 NOT_CONFIGURED, page still serves | GREEN, 1/1 |
| T11 missing-capacity state | Pure extraction + pipeline: unknown state with exact wording, no sellout fields; user/TM capacity labeling; price_unknown | GREEN, 5/5 |
| T12 quota-floor trip (staging) | Monthly budget trip → QUOTA_FLOOR 503; month rollover resets | GREEN, 2/2 |
| T13 per-visitor cap (staging) | Per-IP daily cap → VISITOR_CAP 429; other IPs unaffected | GREEN, 1/1 |
| T14 retry/backoff (local stub) | 429→200 after exactly 2 requests; always-500 after exactly 2; timeout → throw after 2 | GREEN, 3/3 |
| T15 E2E judge path ≤30s on deployed demo | Needs deploy | UNCOVERED |
| T16 no-mock static audit | No fixture imports, no mock/fake/stub identifiers outside strings/comments, NOT_CONFIGURED + verdict_withheld present, no literal key assignment | GREEN, 4/4 (see note) |
| S1 verdict gating | Full evidence → verdict + receipts + miss trial; no key → NOT_CONFIGURED; required-leg failure → WITHHELD with no numbers; optional-leg failure → verdict still renders; ambiguous headliner → needs_input | GREEN, 6/6 |

T16 note: the audit is a tripwire, not proof — T10 is the behavioral
guarantee. During this build the audit's first version failed on its own
over-broad pattern (it matched the word "fixtures" in a documentation
comment); the test was narrowed to import statements and the re-run is
green. The failure and the fix are recorded here, not hidden.

Supporting live evidence (not test rows): `test/ledger/LIVE-CHECKS.md`
(Qloo search ×2, Ticketmaster venues, capacity-field probe, MCP capabilities
without a key, OSM geocode, Wikidata search).

MAX+ status: S1 verdict gating DONE (tested). S2 bench ledger DONE (schema +
`/api/bench` endpoint, empty runs — runs are recorded only from real
trials). S3 receipts manifest DONE (repo manifest shape + per-verdict
receipts with replay data). S4 formula panel DONE (formula + worked example
in real numbers, recomputed from live verdict numbers). S7 live race DONE
(`/api/race` + "Run both" button with timings + miss ledger). S5 stats
strip, S6 wound-first screen, and S8 safety strip presentation DONE in the
Studio frontend (stats strip above the fold, wound hero with custom hero
image on the first screen, visible safety strip). Backend static handler
sends raw bytes with image content types (webp/png/jpeg/avif) — a UTF-8
decode of binary assets corrupted them; fixed and verified byte-identical
for all five frontend assets.

## 9. Deployment steps remaining (no push, no deploy yet)

Settled identities (parent-verified 2026-10-29, awaiting parent confirmation
to proceed): GitHub `mohamedwael201193` (id 72895329 — push path to
`mohamedwael201193/OfferSheet` unblocked on identity); Vercel
`mohamedwael201193` (frontend); Render workspace "Ffcvv's workspace"
(user-confirmed, backend). The local repo is ready to push (see §10) but
NOTHING has been pushed or deployed.

1. Push the local repo to `https://github.com/mohamedwael201193/OfferSheet`
   (after the parent confirms the push step).
2. Render: create the service from `render.yaml` in the Ffcvv workspace.
   Set `QLOO_API_KEY` and `TICKETMASTER_API_KEY` on the Render service from
   the user's own key copies (the vault credential that serves Muse's calls
   does NOT transfer to Render). Optionally set `LLM_*` for the Gut/Web arms.
3. Vercel: create the project from this repo with Root Directory `frontend`
   (so `frontend/vercel.json` applies). Replace the
   `REPLACE-WITH-RENDER-BACKEND-URL` placeholder in `frontend/vercel.json`
   with the real Render backend URL, then deploy.
4. Post-deploy live checks: `qloo setup --status` → "Qloo data: ready" from
   the backend's environment; `qloo exec find_tags` on "jazz" (5 tags);
   a timed verdict end-to-end (T15, target ≤30s); a receipt replay (T08);
   a benchmark trial recorded in `bench/results.json` (S2).

## 10. Repo state

Local git repo, remote set to `https://github.com/mohamedwael201193/OfferSheet.git`,
single clean commit, working tree clean, no push performed. No credentials,
keys, or tokens appear in code, repo, files, or logs (verified by T16 and by
grep for literal key assignments). License: MIT (`LICENSE`, visible in the
repo root, satisfying the public-repo license rule).

## 11. What is blocked on each pending item

| Pending item | Blocks |
|---|---|
| Parent confirmation of the push step | Pushing to `mohamedwael201193/OfferSheet` |
| Parent confirmation of the deploy step | Vercel frontend + Render backend deploys |
| `QLOO_API_KEY` value on the Render service (deploy time) | ALL live Qloo calls from the deployed app (T05, T06 remainder, T07 Qloo legs, T08 remainder, T15) |
| `TICKETMASTER_API_KEY` value on the Render service (deploy time) | Ticketmaster capacity leg only (fallback covers its absence) |
| LLM provider key (optional) | Gut/Web arms only (they render `unavailable`, never fabricated picks) |
| Studio frontend implemented 2026-10-29 (no longer gated on a sketch) | — |
