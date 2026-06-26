# Interactive Fan-out Simulator — Design Addendum

**Date:** 2026-06-23
**Extends:** [2026-06-23-twitter-notification-system-design.md](2026-06-23-twitter-notification-system-design.md)

## Goal

Make the POC interactive: post a synthetic event, then **watch** notifications go out in a browser
dashboard, and **simulate scale from 1k to 1M** — contrasting the two fan-out strategies live.

## Endpoints (new `src/sim/` module; existing slice unchanged)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/sim/run` | Start a run: `{ total, strategy: 'write'\|'realtime'\|'both', windowMs?, ratePerSec?, writeCap? }` → `{ runId }` |
| `GET` | `/sim/watch/:runId` | **SSE** live progress stream (Nest `@Sse`) |
| `GET` | `/sim/runs/:runId` | JSON snapshot (late joiners / polling) |
| static | `/dashboard.html` | Dashboard served via `useStaticAssets` |

## Strategies

- **`write` (real, capped):** insert `min(total, writeCap)` real notification rows for synthetic
  recipients (`sim:{runId}:{i}`), batched in better-sqlite3 transactions, yielding to the event loop
  between batches so SSE stays live. Reports rows written, elapsed, rows/sec, and **linearly
  extrapolated** time + durable-row count for the full `total`. Demonstrates write amplification.
- **`realtime` (simulated, counter-only):** play out delivery of `total` pushes **smeared over
  `windowMs` with jitter**; report live throughput. Compute **required pushes/sec** and, against the
  `ratePerSec` gateway cap, the **implied real duration** (e.g. 1M at 50k/s ⇒ 20s). Zero DB writes.
- **`both`:** run write then realtime; emit a side-by-side summary.

## Components

```
src/sim/
  sim.types.ts          # SimParams, StrategyProgress, SimProgress, RunStatus
  delivery-plan.ts      # pure planDelivery(total, windowMs, ratePerSec) -> plan   (unit-tested)
  write-runner.ts       # createBatchInserter / bulkInsertNotifications             (unit-tested)
  sim-run.store.ts      # Map<runId, {params, snapshot, RxJS Subject}>
  simulator.service.ts  # start() + async execute(): write + realtime, pushes progress to Subject
  sim.controller.ts     # POST /sim/run, GET /sim/runs/:id, @Sse /sim/watch/:id
  start-run.dto.ts      # validated body (total 1..1_000_000, strategy enum, optional knobs)
public/dashboard.html   # log slider 1k–1M, strategy + knobs, Post button, live bars/throughput
test/sim.spec.ts        # planDelivery coverage/cap math; write-runner row count + idempotency
```

SSE = a per-run RxJS `Subject`; the controller returns `concat(of(snapshot), subject)` so late
joiners get the current snapshot then live updates. The client calls `EventSource.close()` on a
`done`/`error` event to avoid the browser's auto-reconnect.

## Safety / constraints

- `writeCap` default **100k**; realtime is counter-only so 1M is cheap.
- `total` validated to ≤ 1,000,000; `windowMs` bounded.
- Default `DB_PATH=:memory:` so repeated runs don't accumulate on disk.
- Run state is in-memory and ephemeral — fine for a demo.
