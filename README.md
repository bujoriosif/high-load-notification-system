# X/Twitter Notification System — POC

A lean NestJS/TypeScript service that builds the **hardest slice** of an X-scale notification
system — hybrid (write-vs-read) fan-out, idempotent dedup, and a merged paginated feed — on
SQLite. The rest of the system (real-time WebSocket, mobile push, the event log) is designed and
explained, but deliberately stubbed.

> Full design doc: [`docs/superpowers/specs/2026-06-23-twitter-notification-system-design.md`](docs/superpowers/specs/2026-06-23-twitter-notification-system-design.md)

## Quick start

```bash
npm install
npm test          # 13 tests: the 4 core behaviours + the simulator math/idempotency
npm run seed      # prints two contrasting feeds (normal vs celebrity author)
npm run start:dev # boots the HTTP API on :3000
# then open the live simulator:
open http://localhost:3000/dashboard.html
```

## How it works

Domain events hit `POST /events`. An **Orchestrator** routes each event by type and by **author
size**:

- **Normal author** (`follower_count < CELEBRITY_THRESHOLD`) → **fan-out-on-write**: one
  notification per follower is written to their inbox.
- **Celebrity author** (≥ threshold) → **no inbox blast**. The post is recorded once as a **pull
  source**; followers' feeds merge it at **read time**. (Real-time push to *connected* followers and
  rate-limited mobile push are where the "instant" happens in prod — stubbed here.)

The **feed read** (`GET /users/:id/notifications`) is a **k-way merge** of the materialized inbox and
recent posts from followed celebrities, newest-first, with a stable composite cursor
(`createdAt,id`). Mark-read is `POST /notifications/:id/read` and `POST /users/:id/notifications/read-all`.

```
POST /events ──▶ Orchestrator ──┬─ normal  ──▶ Fanout (write inbox rows)
                                └─ celebrity ─▶ CelebrityPosts (pull source)
GET feed ──▶ merge(inbox rows, celebrity pull) ──▶ newest-first, paginated
```

### API
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/events` | Ingest a domain event (`eventId`, `type`, `actorId`, `subjectId?`, `targetId?`, `ts?`) → `202 {deduped}` |
| `GET` | `/users/:id/notifications?cursor&limit` | Newest-first, paginated, merged feed |
| `POST` | `/notifications/:id/read` | Mark one as read |
| `POST` | `/users/:id/notifications/read-all` | Mark all read (+ advance pull watermark) |

Event→recipient mapping: `post_created` (actor=author) fans out to followers; `liked`/`replied`
use `targetId` as the recipient (the post owner); `followed` uses `targetId` (the followee) and
updates the graph.

## Interactive simulator (watch it scale 1k → 1M)

`npm run start:dev`, then open `/dashboard.html`. Pick a scale on the log slider (1k–1M), a strategy,
and click **Post & watch** — progress, throughput, and ETA stream in live over SSE. It contrasts the
two fan-out paths so the trade-off is *visible*:

- **Fan-out-on-write** actually materializes rows (capped, default 100k) and extrapolates the full
  cost — you watch write amplification add up.
- **Real-time delivery** smears `total` pushes over a window with jitter and **0 durable rows**, and
  reports the gateway-cap insight (e.g. *1M at a 50k/s cap ⇒ ~20s* — the flash-crowd lesson).

Endpoints: `POST /sim/run` `{ total, strategy, windowMs?, ratePerSec?, writeCap? }` →
`GET /sim/watch/:id` (SSE) + `GET /sim/runs/:id` (snapshot). Run state is in-memory; the realtime path
is counter-only so 1M is instant; `total` is capped at 1,000,000.
See [docs/superpowers/specs/2026-06-23-interactive-simulator-design.md](docs/superpowers/specs/2026-06-23-interactive-simulator-design.md).

## The hardest problem at this scale

**A single celebrity post = up to ~150M notifications.** Fan-out-on-write to every inbox is
catastrophic (write amplification, hot partitions, minute-scale tail latency); pure fan-out-on-read
can't be "instant." The fix is a **hybrid, online-aware** split: pay write cost for normal accounts,
pay read cost for celebrities, and reach only the *connected* slice in real time (the only users who
can perceive "instant"). That asymmetry — and the **idempotent merged read** it forces — is the slice
I built and tested.

Closely tied to it: **idempotency**, which the brief calls out explicitly. There are two strategies,
on purpose:
- **Fan-out / personal events:** effect-level `UNIQUE(recipient_id, dedup_key=eventId)` with
  `INSERT … ON CONFLICT DO NOTHING`. This is safe even for a **partially-applied, crashed** fan-out
  (already-written followers conflict; missing ones fill in) — better than a single "event seen" flag.
- **Aggregatable likes:** the rollup row is shared across many events, so a separate
  `processed_events` guard stops a replayed like from double-incrementing the count.

## What I deliberately left out, and why

- **Real-time WebSocket gateway + presence, mobile push (APNs/FCM), and the Kafka/Kinesis event log**
  are stubbed behind interfaces (`RealtimePublisher`, `PushDispatcher`, in-process orchestrator call).
  They're well-understood infra; the *interesting* correctness lives in routing + dedup + merge.
- **Distributed dedup** is a SQLite `UNIQUE` constraint here; at scale it's a DynamoDB conditional
  write / Redis `SETNX` (± a Bloom filter). Same idea, different substrate.
- **Read-state for pull items** uses a per-user **timestamp watermark** (celebrity items have no row
  to flag), not per-item read flags. `read-all` advances it.
- **Exactly-once and strict per-recipient ordering** are not attempted — impractical at this scale;
  at-least-once + idempotency + best-effort time ordering is the right trade.
- **@mentions** have no dedicated ingest event; when added they follow the `replied` path.

Corners are marked with `// TODO` in the code where cut, with the reason.

## Tests (the part that matters most)

`npm test` — 9 tests over the four behaviours a reviewer should care about:
- **`dedup.spec.ts`** — reprocessing a post creates exactly one row per follower; a *partial*
  fan-out completes on replay without dupes; a replayed like doesn't double-count.
- **`hybrid.spec.ts`** — normal author writes to all followers; celebrity writes **zero** inbox rows
  and one pull source.
- **`feed.spec.ts`** — inbox + celebrity-pull merge newest-first; cursor pagination is stable and
  non-overlapping.
- **`readstate.spec.ts`** — single read flips a row; `read-all` advances the watermark so pulled
  celebrity items read as read.

## Where AI helped / where it misled

- **Helped:** scaffolding the NestJS module wiring, SQLite DDL + cursor-pagination SQL, and the
  exhaustive test cases quickly; surfacing the partial-fan-out idempotency edge case early.
- **Misled / needed correction:** an initial instinct to reach for a full Docker+Kafka+Redis stack —
  wrong for a "don't burn budget on infra" brief; trimmed to SQLite. Also dropped the `ulid`
  dependency after its v3 ESM packaging fought CommonJS/ts-jest — replaced with a tiny in-repo
  time-sortable id generator. Generated SQL needed the composite `(created_at, id)` tiebreak added by
  hand to make pagination truly stable.

## Layout
```
src/
  events/ orchestrator/ fanout/ aggregation/ feed/      # the slice
  follows/ notifications/ celebrity/ db/ common/         # data + helpers
  realtime/ push/                                        # stubs (the "explained" tier)
test/                                                    # the four behaviour specs
```
Config: `CELEBRITY_THRESHOLD` (default 1000), `DB_PATH` (default `:memory:`), `PORT` (default 3000).
