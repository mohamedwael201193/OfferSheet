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

Live demo: https://offersheet-rouge.vercel.app (frontend) backed by
https://offersheet-backend-k2zp.onrender.com (Render Starter, see §9). A
real verdict runs end to end on it (see §8 T15). No screenshots are
included here: none have been captured from the deployed demo, and none
are fabricated. The frontend in this repo is the
full Studio design system (light studio-white proof paper, ink dot grid,
blue-black ink, Hedvig Letters Serif heads, crop marks, cadmium-orange
construction guides + the one primary action): wound hero with a custom
hero image, stats strip, verdict tool with the verdict card as page hero,
live Gut-vs-Graph race (it runs; the Gut/Web arms report `unavailable`
without an LLM key — see §8 T07), receipt drawer with replay, formula panel, safety
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
| `NODE_VERSION` | Pinned to `22` on Render: the official Qloo MCP harness requires Node ≥ 22.19. |
| `QLOO_MCP_COMMAND` | Path to the harness binary on the backend host (`node_modules/.bin/qloo`, installed at build time by `render.yaml`'s `buildCommand`). |
| `QLOO_BASE_URL` / `QLOO_TRUSTED_BASE_URL` | Both set to `https://hackathon.api.qloo.com` on Render. The harness defaults to the production host, where the hackathon key does NOT authenticate; a non-production host additionally requires the trusted-base-URL gate to pass. |
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
| T05 MCP chain live (all 10 tools) | COVERED live 2026-10-29 on the deployed demo: a real verdict (Billie Eilish / New York / $48,000 / $60) ran all 10 tools (capabilities probe + find_tags, describe, recommend, rank, where_popular, audience_demographics, compare_audiences, entity_tags, trends) with 11 receipts | COVERED |
| T06 REST receipt leg live | `/search` verified live on the deployed demo: verdict leg ok, and a replay of the exact call returned 5 results; the `/v2/insights` leg is skipped by the pipeline (optional) | PARTIAL (search leg live; insights leg skipped) |
| T07 three-arm run live | Race runs live (13.7s, graph pick Olivia Rodrigo) but Gut/Web arms report `unavailable` — no LLM provider key is set, so no comparison pick exists; a three-arm trial needs `LLM_*` keys | UNCOVERED (needs LLM keys) |
| T08 receipt replay live | MCP replay of the verdict's find_tags receipt returned result_count 10 = original 10 (match); REST replay of the verdict's /search receipt returned 5 results | COVERED |
| T09 red→green regression (process) | Red run (missing module) + green run on disk | EVIDENCED |
| T10 no-key 503 staging run | Server with no key: health `qlooConfigured: false`, verdict 503 NOT_CONFIGURED, page still serves | GREEN, 1/1 |
| T11 missing-capacity state | Pure extraction + pipeline: unknown state with exact wording, no sellout fields; user/TM capacity labeling; price_unknown | GREEN, 5/5 |
| T12 quota-floor trip (staging) | Monthly budget trip → QUOTA_FLOOR 503; month rollover resets | GREEN, 2/2 |
| T13 per-visitor cap (staging) | Per-IP daily cap → VISITOR_CAP 429; other IPs unaffected | GREEN, 1/1 |
| T14 retry/backoff (local stub) | 429→200 after exactly 2 requests; always-500 after exactly 2; timeout → throw after 2 | GREEN, 3/3 |
| T15 E2E judge path ≤30s on deployed demo | COVERED live 2026-10-29: verdict via the public demo URL in 17.2s wall (timingMs 16196), status `verdict`, break-even 800 tickets, capacity `unknown` with the verbatim MAX-spec message | COVERED |
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

## 9. Deployment status (2026-10-29 — LIVE)

Settled identities (parent-verified 2026-10-29): GitHub
`mohamedwael201193` (id 72895329); Vercel `mohamedwael201193` (frontend);
Render workspace "Ffcvv's workspace" (user-confirmed, backend).

1. Push: DONE via the GitHub API (remote `main` now at the commit in §10).
   Git CLI push was not used because the vault-held token is never
   revealed to the shell.
2. Render: LIVE. Service `offersheet-backend` in the Ffcvv workspace on
   the **Starter plan** (user-authorized $7 on 2026-10-29, NOT free —
   the free-tier quota had blocked two earlier creation attempts with
   HTTP 400). URL: https://offersheet-backend-k2zp.onrender.com.
   `buildCommand` installs the official Qloo MCP harness
   (`npm install @qloo/qloo-harness`); the harness is pointed at the
   hackathon API host via `QLOO_BASE_URL` +
   `QLOO_TRUSTED_BASE_URL` (its production default rejects the
   hackathon key with QLOO_AUTH — diagnosed from a live MCP replay and
   fixed from the harness's own source). Env vars set via the Render
   API from the user's authorized env file: `QLOO_API_KEY`,
   `TICKETMASTER_API_KEY` (values never in the repo, logs, or this
   file). Health: `/api/health` → `status ok`, `qlooConfigured true`,
   `ticketmasterConfigured true`, `llmConfigured false`.
   Two deploy gotchas recorded: the direct Render API requires a
   `buildCommand` (`render.yaml` originally omitted one) and a manual
   deploy trigger needs an empty body (a JSON body is rejected as
   "invalid JSON"); updating env vars via the API does NOT trigger a
   redeploy — a manual deploy must follow.
3. Vercel: LIVE. Project `offersheet` (id `prj_7c6rh7AMxoucqVwzNCQEkjUMsQoD`),
   production URL https://offersheet-rouge.vercel.app
   (`offersheet.vercel.app` belongs to an unrelated project, so Vercel
   assigned the `rouge` alias). The frontend is deployed from the
   committed repo tree via the file-upload API (SHA flow: upload each
   file to `/v2/files`, then create the deployment by SHA) — the
   `files[].data` base64 form is stored verbatim by Vercel and served
   back as base64 text, which broke the first two deployments; the
   SHA flow serves real bytes (hero webp byte-identical, 429,630
   bytes). `frontend/vercel.json` rewrites `/api/*` to the Render
   backend (same-origin only: the backend sends no CORS headers).
   Git-linked deploys are NOT wired: project creation with a GitHub
   repo fails with "add a Login Connection to your GitHub account
   first" — that OAuth step is a user-side dashboard action, and until
   it is done, redeploys are file-uploads, not automatic on push.
4. Post-deploy live checks, all run 2026-10-29 on the public demo:
   timed verdict end-to-end (T15) 17.2s, status `verdict`, break-even
   800 tickets, capacity `unknown` with the verbatim MAX-spec message;
   receipt replay (T08) MCP match 10/10 + REST 5 results; MCP chain
   (T05) all 10 tools live; race (T07) runs with graph pick only
   (Gut/Web `unavailable`, no LLM keys). Benchmark trial (S2): NOT
   recorded — the ledger's own rule requires a real comparison pick,
   and none exists without LLM arms (runs stay `[]`, never fabricated).

## 10. Repo state

Local git repo, remote set to `https://github.com/mohamedwael201193/OfferSheet.git`.
Remote `main` was at `432dc00bcc859f14f92ac0c02df362ad53fbefc6` (the
`render.yaml` deploy-config commit) before this docs commit; this
commit updates §5/§6/§8/§9/§11 to the deployed state. Local QA
commits (design audit, animation+UX, test deepener) are NOT pushed —
they must rebase onto the new remote HEAD before their planned push.
No credentials, keys, or tokens appear in code, repo, files, or logs
(verified by T16 and by grep for literal key assignments). License: MIT
(`LICENSE`, visible in the repo root, satisfying the public-repo
license rule).

## 11. What is blocked on each pending item

| Pending item | Blocks |
|---|---|
| LLM provider key (`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`) on the Render service | Gut/Web arms (T07 three-arm live) and the benchmark trial (S2, which by rule needs a real comparison pick) — both arms honestly report `unavailable` until then |
| Vercel GitHub Login Connection (user-side dashboard OAuth) | Git-linked auto-redeploy on push; redeploys are currently file-uploads via the API |
| Studio frontend implemented 2026-10-29 (no longer gated on a sketch) | — |
