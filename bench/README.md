# Benchmark ledger

`results.json` holds committed, rerunnable Qloo-vs-LLM-only-vs-third-arm
trials. Rules:

- A trial is recorded ONLY from a real run (live Qloo calls + real arm
  outputs). Nothing is narrated, backfilled, or fabricated.
- A trial exists only when the graph pick and at least one comparison pick
  both came from real runs. If an arm was unconfigured, no trial is recorded
  for that run — the miss ledger shows "no trial", not zero misses.
- How to record a run: run a live verdict (or `/api/race`) against the
  deployed demo, then append the trial object to `results.json` with the
  run's question, picks, misses, timestamp, and timing. The live server does
  NOT write to the repo; the operator appends from observed runs.
- The `/api/bench` endpoint serves this file so judges can check it without
  opening the repo.
