# Twitter Notification POC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (This plan is being executed inline in one shot at the user's request.)

**Goal:** A lean NestJS/TypeScript service that builds the hardest slice of an X-scale notification system — hybrid (write-vs-read) fan-out, idempotent dedup, and a merged paginated feed — backed by SQLite.

**Architecture:** Domain events hit `POST /events` → an Orchestrator routes by event type and author size (normal ⇒ fan-out-on-write to follower inboxes; celebrity ⇒ record a pull source, no blast). Idempotency is enforced by a SQLite `UNIQUE(recipient, dedup_key)` for fan-out/personal events and a `processed_events` guard for aggregatable likes. The feed read merges the materialized inbox with recent posts from followed celebrities via a k-way merge with composite-cursor pagination.

**Tech Stack:** NestJS, TypeScript, better-sqlite3, ulid, class-validator, Jest + ts-jest.

## Global Constraints

- Node ≥ 20 (developed on v24).
- Storage: SQLite via better-sqlite3 only. No external infra.
- Celebrity threshold is env-configurable (`CELEBRITY_THRESHOLD`, default 1000).
- Real-time WebSocket push, mobile push, and the Kafka event log are **stubbed behind interfaces** with `// TODO` notes — not built.
- Time-sortable IDs via ULID; ordering is `(created_at DESC, id DESC)`.

---

## File structure

```
src/
  main.ts                                  # bootstrap + global ValidationPipe
  app.module.ts                            # DI wiring (DB, threshold, repos, services, controllers)
  common/types.ts                          # DomainEvent, NotificationRow, FeedItem, enums
  common/ids.ts                            # monotonic ULID helper
  common/cursor.ts                         # encode/decode composite cursor
  db/schema.ts                             # SCHEMA_SQL DDL string
  db/database.ts                           # createDatabase(path) → better-sqlite3 instance
  follows/follows.repository.ts            # graph + follower_count + celebrity followees
  notifications/notifications.repository.ts# inbox: insertIfNew, page, mark read, aggregates
  celebrity/celebrity-posts.repository.ts  # pull source
  aggregation/processed-events.repository.ts # double-count guard
  aggregation/aggregator.service.ts        # like rollup
  feed/watermark.repository.ts             # pull read watermark
  feed/feed.service.ts                     # k-way merge + pagination + mark read
  feed/feed.controller.ts                  # GET feed, POST read, read-all
  fanout/fanout.service.ts                 # normal-author write fan-out
  orchestrator/priority.ts                 # type → priority
  orchestrator/orchestrator.service.ts     # routing + dedup + hybrid decision
  events/ingest-event.dto.ts               # POST /events body validation
  events/events.controller.ts              # POST /events
  realtime/realtime.publisher.ts           # interface + logging stub
  push/push.dispatcher.ts                  # interface + logging stub
  seed/seed.ts                             # demo: celebrity w/ N followers + normal users
test/
  helpers.ts                               # in-memory context builder
  dedup.spec.ts  hybrid.spec.ts  feed.spec.ts  readstate.spec.ts
package.json  tsconfig.json  jest.config.js  .gitignore  README.md
```

---

## Tasks

### Task 1: Project scaffold
**Files:** Create `package.json`, `tsconfig.json`, `jest.config.js`, `.gitignore`.
- [ ] Add NestJS + better-sqlite3 + ulid + class-validator deps and Jest/ts-jest dev deps.
- [ ] tsconfig: commonjs, ES2021, decorators on, `strictPropertyInitialization:false`.
- [ ] `npm install`; verify it completes (better-sqlite3 prebuilt binary).

### Task 2: DB + common utils
**Files:** `db/schema.ts`, `db/database.ts`, `common/types.ts`, `common/ids.ts`, `common/cursor.ts`.
**Produces:** `createDatabase(path)`, `SCHEMA_SQL`, `newId(ts)`, `encodeCursor/decodeCursor`, shared types.
- [ ] DDL for follows, users, notifications (UNIQUE(recipient_id,dedup_key)), celebrity_posts, pull_read_watermark, processed_events.
- [ ] `createDatabase` runs schema, sets `journal_mode=WAL` for file DBs.

### Task 3: Repositories
**Files:** the five `*.repository.ts`.
**Produces (key signatures):**
- `FollowsRepository`: `addFollow(follower,followee,ts)`, `getFollowerIds(id)`, `getCelebrityFolloweeIds(id,threshold)`, `getFollowerCount(id)`, `isCelebrity(id,threshold)`.
- `NotificationsRepository`: `insertIfNew(row):boolean`, `getInboxPage(recipient,cursor,limit):NotificationRow[]`, `markRead(id,ts):boolean`, `markAllRead(recipient,ts):number`, `findByDedup(recipient,key)`, `incrementAggregate(id,actor,ts,sample)`.
- `CelebrityPostsRepository`: `addPost(id,author,ts):boolean`, `getRecentByAuthors(ids,cursor,limit)`.
- `ProcessedEventsRepository`: `markIfNew(eventId):boolean`.
- `WatermarkRepository`: `get(userId):number|null`, `advance(userId,ts)`.

### Task 4: Services
**Files:** `orchestrator/priority.ts`, `fanout/fanout.service.ts`, `aggregation/aggregator.service.ts`, `orchestrator/orchestrator.service.ts`, `feed/feed.service.ts`, `realtime/*`, `push/*`.
**Produces:** `OrchestratorService.handle(event):{accepted,deduped}`, `FeedService.getFeed/markRead/markAllRead`.
- Orchestrator routes: `post_created`→hybrid; `liked`→aggregator; `replied`→high single; `followed`→graph update + single.
- Fan-out: dedup_key=eventId per follower.
- Aggregator: `processed_events` guard + rollup by `agg:{subject}:like`.
- Feed: merge inbox + celebrity-pull, top `limit`, composite next-cursor.

### Task 5: Controllers + wiring
**Files:** `events/*`, `feed/feed.controller.ts`, `app.module.ts`, `main.ts`.
- DTO validation; `POST /events` → 202 `{accepted,deduped}`; feed endpoints.

### Task 6: Tests (the deliverable)
**Files:** `test/helpers.ts` + four specs.
- dedup (reprocess + partial + replayed like), hybrid routing, merge/pagination, read-state.
- [ ] `npm test` → all green.

### Task 7: Seed/demo + README
- `npm run seed` prints two contrasting feeds (normal vs celebrity author).
- README per deliverables (how it works, hardest problem, cuts, AI notes, tests).

---

## Self-review notes
- Spec coverage: all 4 required APIs (ingest, paginated fetch, mark single/all read) + dedup + hybrid + merge are tasked.
- Read-state for pull items uses a timestamp watermark (impl detail; spec used a ULID watermark — equivalent, timestamp is simpler).
- mention has no ingest event (documented cut); reply path is the template.
