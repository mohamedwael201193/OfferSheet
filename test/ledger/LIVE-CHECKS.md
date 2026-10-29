# Live checks (supporting evidence — NOT test rows, unless noted)

All runs below are real runs dated 2026-10-29. No key value appears anywhere.
The connector credential serves Muse's calls only; the deployed app needs its
own `QLOO_API_KEY` / `TICKETMASTER_API_KEY` set on its host (Render) at deploy
time. Where a check below says UNCOVERED, the app code path is complete but
unverified until that deploy-time key exists.

## Qloo — connector search (verified twice, identical)

Command (connector helper, read-only):

```text
python3 ~/workspace/custom-connectors/custom.qloo-hackathon/bin/qloo_search.py jazz 5
```

Run 1 and run 2 (same day, same args) both returned:

```json
{"http_status": 200, "result_count": 5, "first_names": ["Jazz", "Jazz", "Jazz (Beloved Trilogy, #2)", "Jazz", "Jazz"]}
```

- Test-matrix credit: T06 PARTIAL (search leg verified live; `/v2/insights`,
  `/v2/analysis/compare`, `/entities` legs remain UNCOVERED — they need the
  deploy-time key in the app's own environment).
- Test-matrix credit: T08 PARTIAL (search-leg replay reproduced: two identical
  runs returned the same names in the same order; full receipt replay across
  all tools remains UNCOVERED).

## Ticketmaster — connector venues (verified)

Command (connector helper, read-only):

```text
python3 ~/workspace/custom-connectors/custom.ticketmaster/bin/ticketmaster_venues.py "Madison Square Garden"
```

Returned:

```json
{"http_status": 200, "result_count": 1, "first_names": ["Madison Square Garden"]}
```

## Ticketmaster — capacity-field probe (real venue response)

A minimal read probe through the same approved connector flow (surrogate only;
it prints venue field names, never headers or credentials) fetched the full
Madison Square Garden venue record and printed only its top-level keys plus
capacity-like fields. Result, 2026-10-29:

- HTTP 200, venue "Madison Square Garden".
- Top-level keys (25): `_links`, `accessibleSeatingDetail`, `ada`, `address`,
  `aliases`, `boxOfficeInfo`, `city`, `country`, `dmas`, `generalInfo`, `id`,
  `images`, `locale`, `location`, `markets`, `name`, `parkingDetail`,
  `postalCode`, `social`, `state`, `test`, `timezone`, `type`,
  `upcomingEvents`, `url`.
- Capacity fields: ABSENT. No `capacity` and no `seatingCapacity` at top level,
  and `generalInfo` contains neither.

Consequence: for this room the app's "unknown capacity" state is the CORRECT
behavior, not a failure — break-even renders as tickets needed, with no sellout
percentage, no "will sell out" claim, and no room-fill claim. Whether other
venues carry a capacity field is unproven; `extractCapacity` checks the fields
generically, so a venue that does report one will render it labeled
"Ticketmaster-reported". The fallback stands regardless.

## MCP transport — capabilities without a key (gate signal, not a data call)

A stdio probe spawned `qloo mcp`, initialized (protocolVersion 2024-11-05),
and called `qloo_capabilities` with NO key in the environment. The call
succeeded at the transport level and returned a capability manifest document
(`manifest_schema_version` 1.1, `contract_version` 1.0.0,
`result_schema_version` 1.0-preview.1, statuses ok / empty / needs_input /
partial / degraded / error). No Qloo data was returned and none was requested:
`qloo_capabilities` reports readiness without calling Qloo data, per the kit
docs. The app's real gate is the first data call, which fails closed
(`QLOO_AUTH` 503) when the key is missing or invalid.

Also recorded at build start, 2026-10-29, with no key:

```text
qloo setup --status
→ "Qloo data: learning mode; no API credential" / "Model: not configured" /
  "Chat: requires model-provider sign-in"
```

## OpenStreetMap Nominatim — geocode (1 query, keyless)

```text
GET https://nominatim.openstreetmap.org/search?format=json&q=New York&limit=1
→ display_name "New York, United States", lat 40.7127281, lon -74.0060152
```

## Wikidata — entity search (1 query, keyless)

```text
GET https://www.wikidata.org/w/api.php?action=wbsearchentities&search=Billie Eilish&language=en&format=json&limit=5
→ first match Q29564107, "Billie Eilish", "American singer-songwriter (born 2001)"
```

## What is still UNCOVERED (no key in the app's environment yet)

- T05 MCP chain live (all 10 tools through the app's stdio transport).
- T06 REST legs beyond `/search` (insights, compare, entities).
- T07 three-arm run live (needs the Qloo key AND an LLM provider key).
- T08 full receipt replay (all tools, not just the search leg).
- T15 end-to-end judge path timed on the deployed demo (needs deploy).
- `qloo setup --status` → "Qloo data: ready" and `qloo exec find_tags` on
  "jazz" (5 tags) from the deployed backend's environment.
