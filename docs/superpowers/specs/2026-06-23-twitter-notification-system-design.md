# X/Twitter Notification System — Design & POC Spec

**Date:** 2026-06-23
**Context:** Interview take-home — design the notification system for an X/Twitter-scale platform (≈500M users/day, ≈200M DAU, celebrities with up to ≈150M followers) and build a meaningful slice as a NestJS/TypeScript POC.

---

## 1. Goal & framing

Two deliverables:

1. A **full conceptual design** with reasoned trade-offs (data structures, cloud services, fan-out strategy).
2. A **runnable, lean POC** in NestJS that builds *the hardest slice well* and clearly explains the rest — matching the interviewer's brief: identify the genuinely hard problem, build a meaningful slice, explain the remainder.

The interviewer evaluates **how we think** over completeness: did we find the hard problems before coding, are trade-offs reasoned (not asserted), is the chosen slice the right one, is the README honest about what's done vs not.

---

## 2. Requirements (locked)

| Dimension | Decision |
|---|---|
| **Delivery surfaces** | Real-time in-app (WebSocket), mobile push (APNs/FCM), durable bell-icon feed. (No email.) |
| **Priority classes** | High-priority = **tiered** (connected users fast, long tail lazy); best-effort = throughput-first. Configurable per notification. |
| **Event types** | New-post fan-out (celebrity centerpiece), personal low-fan-out (reply/mention/follow), aggregatable (likes/reposts rollup). DMs out of scope. |
| **Delivery guarantees** | **Per-priority split**: high-priority = at-least-once + persisted to durable feed + client dedup key; best-effort = at-most-once fire-and-forget. Ordering best-effort via time-sortable IDs. |
| **Cloud** | AWS-anchored. |
| **POC stack** | NestJS / TypeScript, **SQLite** (better-sqlite3), local only, no heavy infra. |
| **POC slice** | Hybrid fan-out routing + idempotent dedup + merged paginated read. |

---

## 3. Core decision — fan-out strategy

The 150M-follower number is the crux. Back-of-envelope:

- 200M DAU; avg user follows a few hundred accounts and posts a few times/day.
- Avg fan-out ~500 followers × hundreds of millions of posts ⇒ **~10^11+ notification events/day** (millions/sec average, with spikes).
- **One celebrity post = 150M notifications** — bigger than most companies' entire daily volume.
- **Key insight:** at any instant only a slice of followers are *connected*. Only connected users can perceive "instant," so the real-time path only needs to reach the online slice — not all 150M.

### Approaches considered

- **A. Pure fan-out-on-write** — write a notification to every follower's inbox on post.
  - ✅ Trivial reads, easy ordering. ❌ Catastrophic write amplification for celebrities, hot partitions, wasted writes, minute-scale tail latency. **Fails the celebrity case.**
- **B. Pure fan-out-on-read** — store the post once, build feeds at read time.
  - ✅ O(1) writes, cheap storage. ❌ No natural push ⇒ can't be "instant"; expensive reads. **Fails the "instant" requirement.**
- **C. Hybrid, online-aware, priority-tiered (CHOSEN)**
  - Normal accounts (below follower threshold): fan-out-on-write to inboxes + real-time push to connected followers.
  - Celebrity accounts (above threshold): no inbox blast — publish once to topic `author:{id}` delivered only to *connected* followers; record the post as a **pull source** merged into followers' feeds at read time; mobile push via a rate-limited best-effort worker.
  - Priority classes ride on top (mentions/replies always durable at-least-once; celebrity new-post best-effort for the inactive long tail).
  - ✅ Bounds write amplification, makes "instant" tractable, cost-efficient, matches real X. ❌ Two write paths + read-path merge, needs a follower threshold and presence tracking.

**Rationale:** Only C survives 150M followers without melting, and it directly exploits the "only connected users perceive instant" insight.

---

## 4. Architecture & data flow

```
  Post/Reply/Like services emit domain events
              │
              ▼
   Event Log (Kafka/Kinesis: events)   ← [POC: in-process call]
              │ consume
              ▼
   Notification Orchestrator (fan-out router)
   classify: type, priority, author size (normal vs celebrity)
        │                               │
 normal │ (fan-out ON WRITE)            │ celebrity (HYBRID)
        ▼                               ▼
 Fan-out Workers                  publish ONCE to topic author:{id}
 • write durable inbox            • real-time push to CONNECTED followers
 • push if online                 • store post as PULL source for feed
 • enqueue mobile push            • rate-limited mobile push (best-effort)
        │                               │
        ├──────────────┬────────────────┼───────────────┐
        ▼              ▼                 ▼               ▼
  Durable Feed    Presence Svc     Real-time Gateway  Mobile Push
  (inboxes +      (who's online    (WebSocket nodes,  Dispatch →
   celeb pull)     + which node)    topic subs)        APNs/FCM
        │
   bell-icon read = merge(inbox, celeb-pull) → Read API (newest-first, paginated)
```

The asymmetry is the whole trick: normal accounts pay bounded write cost; celebrities pay read cost + a bounded online-only push, avoiding the 150M blast.

---

## 5. Components

### Built — NestJS service

| Component | Responsibility |
|---|---|
| **Events Controller** (`POST /events`) | Validate inbound event (`eventId`, `type`, `actorId`, `subjectId`, `ts`); `eventId` is the idempotency anchor; hand to Orchestrator. |
| **Notification Orchestrator** | Map event → notification type + priority; run the **hybrid decision**; apply **idempotent dedup**; route aggregatable events to rollup. The one place that knows routing rules. |
| **Fan-out worker** (in-process) | Normal authors: enumerate followers in chunks, create one dedup-guarded notification each. `// TODO`: a queue + worker fleet in prod. |
| **Aggregator** | Collapse likes/reposts into one rollup notification (`aggActors[]` + `aggCount`) with a double-count guard. |
| **Feed Read Model** (`GET /users/:id/notifications`) | Newest-first, cursor-paginated read that **merges** materialized inbox with recent posts from followed celebrities (pull source). |
| **Read-state** (`/read`, `/read-all`) | Mark single or all read; interacts correctly with the merged push+pull view. |
| **Repositories (SQLite)** | Notifications, Follows, CelebrityPosts, AggregateState — behind interfaces that map to DynamoDB conceptually. |

### Explained — not built (described in README + this doc)

- **Event log (Kafka/Kinesis)** — durable, partitioned ingest + replay; the in-process call is the seam.
- **Real-time WebSocket gateway + Presence service** — online push, celebrity topic-subscriptions.
- **Mobile push dispatcher** — device-token store + SNS Mobile Push → APNs/FCM, rate-limited.
- **Distributed dedup** — at scale this becomes a DynamoDB conditional write / Redis `SETNX`, not a SQLite UNIQUE constraint.

---

## 6. Data structures

### Conceptual (at scale)

| Need | Structure | AWS mapping | Trade-off |
|---|---|---|---|
| Per-user inbox (newest-first, paginated, capped) | Sorted set keyed by user, scored by time-sortable ID | Redis ZSET (hot) over DynamoDB (PK=user, SK=ULID desc) | ZSET fast but RAM-bound/eviction; DynamoDB durable + infinite scale, higher latency. |
| Dedup / idempotency | Authoritative unique key (`recipient+eventId`), optionally Bloom-filtered | DynamoDB conditional write (`attribute_not_exists`); Redis `SETNX`+TTL; Bloom | Exactness vs memory vs latency. Bloom false-positives can drop a legit notification (tunable). |
| Follower graph | Adjacency lists + per-user follower-count counter | Graph/social service; DynamoDB | Never load a 150M follower list whole; the count gates the routing decision. |
| Celebrity pull source | Per-author capped recent-posts sorted set | Redis ZSET / DynamoDB (PK=author, SK=ULID desc) | Trades read cost for avoided write amplification — the core hybrid bet. |
| Aggregation state | Counter + bounded actor sample (ring buffer) keyed by `(recipient, subject, type)` | Redis hash + capped list, or DynamoDB atomic `ADD` | Bounded sample keeps rows small; needs a "seen eventIds" guard. |
| Priority lanes | Separate queues per priority class | Separate Kinesis streams / SQS queues + DLQ | High-priority durable retry; best-effort load-sheds under pressure. |
| Presence + celebrity real-time | `userId → {node, connId}`; per-node `authorId → connIds` | Redis hash/set; API GW WebSocket + pub/sub | Publish once per celebrity post; fan-out bounded by online followers. |

The read path's core algorithm is a **k-way merge of sorted streams** (min-heap by timestamp): the inbox is one stream, each followed celebrity's recent posts another.

### Concrete SQLite schema (POC)

```sql
CREATE TABLE follows (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX idx_follows_followee ON follows(followee_id);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  follower_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,          -- ULID (time-sortable)
  recipient_id TEXT NOT NULL,
  type         TEXT NOT NULL,             -- post | reply | follow | like_rollup  (mention reuses the reply path; see §9)
  priority     TEXT NOT NULL,             -- high | best_effort
  actor_id     TEXT,
  subject_id   TEXT,
  created_at   INTEGER NOT NULL,
  read_at      INTEGER,                   -- NULL = unread
  dedup_key    TEXT NOT NULL,             -- = source eventId (or aggregate key)
  agg_count    INTEGER DEFAULT 1,
  agg_actors   TEXT,                      -- JSON bounded sample
  UNIQUE (recipient_id, dedup_key)        -- idempotency enforced by the DB
);
CREATE INDEX idx_notif_feed ON notifications(recipient_id, created_at DESC, id DESC);

CREATE TABLE celebrity_posts (
  id         TEXT PRIMARY KEY,
  author_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_celeb_author ON celebrity_posts(author_id, created_at DESC, id DESC);

CREATE TABLE pull_read_watermark (
  user_id   TEXT PRIMARY KEY,
  watermark TEXT NOT NULL                 -- ULID; pull items <= watermark are "read"
);

CREATE TABLE processed_events (
  event_id TEXT PRIMARY KEY               -- aggregation double-count guard
);
```

**Cursor pagination:** composite cursor `(created_at, id)`. Query inbox and each followed celebrity's posts with `WHERE … (created_at,id) < (?,?) ORDER BY created_at DESC, id DESC LIMIT k`, then heap-merge to the top `k` and emit the next cursor. Stable under concurrent inserts.

### Two subtle correctness points (flag in README)

1. **Dedup vs aggregation tension.** Plain fan-out dedups by `(recipient, eventId)`. Aggregatable likes *want* to fold many events into one row, keyed by `(recipient, subject, type)`, with a per-event "seen" guard (`processed_events`) so a replayed like doesn't double-increment. Two idempotency strategies in one system.
2. **Read-state for pull items.** Celebrity items aren't rows, so no per-item `read_at`. A per-user **read watermark** marks everything ≤ watermark read; `read-all` advances it. Deliberate, documented simplification.

---

## 7. AWS cloud-services mapping & trade-offs

| Stage | Recommended | Alternatives | Deciding trade-off |
|---|---|---|---|
| Event log / ingest | Kinesis Data Streams (ordered per shard, replay) | MSK (Kafka); SQS/SNS | Kinesis managed + replay but watch hot shards; MSK more throughput/ops; SQS simple but no replay/weak ordering. |
| Fan-out compute | Lambda (scales with shards) | ECS/EKS Fargate; EC2 | Lambda effortless spiky autoscale but 15-min cap/cold starts; Fargate steady throughput but you own scaling. |
| Durable inbox | DynamoDB single-table (PK=user, SK=ULID), TTL cap, Streams | Aurora; Keyspaces | Serverless single-digit ms, but partition-key design is everything — a celebrity inbox hot-partitions (why we don't fan them out). |
| Hot cache / dedup / presence | ElastiCache Redis (ZSET feeds, SETNX/Bloom, presence) | MemoryDB | Redis microsecond ops but RAM-bound/eviction; MemoryDB for durable Redis at higher cost. |
| Real-time delivery | API Gateway WebSocket (moderate scale) | Self-managed WS on Fargate+NLB; AppSync; IoT Core (MQTT) | API GW managed but per-message cost/conn limits; at true scale build own fleet or use IoT Core MQTT. |
| Mobile push | SNS Mobile Push → APNs/FCM + rate-limited workers | Pinpoint; direct APNs/FCM | SNS managed + cheap; Pinpoint adds segmentation at cost; direct = max control but own token lifecycle/retries. |
| Priority lanes | Separate Kinesis/SQS per priority + DLQ on high-priority | Single stream w/ in-app prioritization | Physical separation lets best-effort shed load while high-priority retries durably. |
| Observability | CloudWatch + X-Ray; autoscale on queue depth / iterator age; DLQs | — | Iterator age is the canary for fan-out falling behind during a celebrity spike. |

**Net pick:** Kinesis → Lambda fan-out → DynamoDB inboxes + ElastiCache Redis (hot feeds/dedup/presence) → self-managed WebSocket fleet + SNS Mobile Push, with per-priority queues.

---

## 8. POC plan (NestJS)

### Module layout
```
src/
  events/        events.controller.ts        # POST /events  (+ IngestEventDto)
  orchestrator/  orchestrator.service.ts      # routing + dedup + hybrid decision
                 priority.ts                  # event-type → priority mapping
  fanout/        fanout.service.ts            # normal-author in-process fan-out
  aggregation/   aggregator.service.ts        # like/repost rollup + double-count guard
  feed/          feed.controller.ts           # GET feed, POST read, POST read-all
                 feed.service.ts              # k-way merge + cursor pagination
  follows/       follows.repository.ts        # graph + follower_count + isCelebrity()
  notifications/ notifications.repository.ts  # SQLite inbox
  celebrity/     celebrity-posts.repository.ts# pull source
  realtime/      realtime.publisher.ts        # INTERFACE + no-op/log impl (stubbed)
  push/          push.dispatcher.ts           # INTERFACE + log impl (stubbed)
  common/        ulid.ts, cursor.ts           # time-sortable ids, composite cursor codec
  db/            schema.sql, db.provider.ts   # better-sqlite3 (':memory:' in tests)
  seed/          seed.ts                       # 1 celebrity w/ N followers + normal users
```
Storage: **better-sqlite3** (synchronous, `:memory:` for tests). `RealtimePublisher` / `PushDispatcher` are interfaces with logging stubs — the seams for the "explained" tier.

### API contracts
```http
POST /events
{ "eventId":"evt_123", "type":"post_created|liked|replied|followed",
  "actorId":"userA", "subjectId":"post_789", "ts": 169... }   → 202 {accepted, deduped}

GET /users/:id/notifications?cursor=<opaque>&limit=20
→ { items:[{id,type,actorId,subjectId,createdAt,read,aggCount,aggActors}], nextCursor }

POST /notifications/:id/read              → marks one materialized row read
POST /users/:id/notifications/read-all    → flips inbox rows + advances pull watermark
```
Routing per type: `post_created`→hybrid; `liked`→aggregatable rollup to post author; `replied`→high-priority single; `followed`→single + graph update.

### Core mechanics
- **Hybrid decision:** on `post_created`, look up author `follower_count`; `>= CELEBRITY_THRESHOLD` (env) → one `celebrity_posts` row (pull, no blast); else → `fanout.service` writes one dedup-guarded notification per follower.
- **Idempotency — two strategies:**
  - Fan-out & personal: effect-level `INSERT … ON CONFLICT(recipient_id, dedup_key=eventId) DO NOTHING` — safe on partial re-runs.
  - Aggregation: rollup keyed by `(recipient, subject, type)` + `processed_events` guard against double-increment.

### Built vs stubbed
- **Built:** ingest, orchestrator (routing+dedup+hybrid), in-process fan-out, aggregation, merged+paginated feed read, mark-read (single/all), SQLite repos, seed + demo script.
- **Stubbed with `// TODO`:** real-time WebSocket push, mobile push, Kafka log (in-process call is the seam), distributed dedup (UNIQUE → DynamoDB conditional write at scale).

### Tests — on the parts that matter most
1. **Dedup:** same `eventId` twice ⇒ exactly one row per recipient; partial-fanout replay completes with no dupes; replayed like ⇒ `agg_count` increments once.
2. **Hybrid routing:** normal author ⇒ rows for all followers; celebrity (above threshold) ⇒ zero inbox rows + one pull-source row.
3. **Merge + pagination:** feed merges inbox + celebrity-pull newest-first; cursor paging stable, non-overlapping, respects `limit`.
4. **Read-state:** `read-all` advances watermark so pull items read as read; single read flips one inbox row.

### README outline (matches deliverables)
How it works + decisions · the hardest problem (celebrity write/read asymmetry + idempotent merged read) and how we approached it · what we left out and why (real-time/push/Kafka, exactly-once, strict ordering) · where AI helped/misled · `// TODO` corner-cut notes throughout.

---

## 9. Open items / deliberate cuts

- Real-time WebSocket gateway, presence, and mobile push are **stubbed behind interfaces**, not built.
- No real event log; the in-process orchestrator call stands in for Kafka/Kinesis.
- Exactly-once and strict per-recipient ordering are explicitly **not** attempted (impractical at scale; documented as such).
- Read-state for pull items uses a watermark, not per-item flags.
- @mentions are in scope conceptually but have no dedicated ingest event in the POC; mention parsing from post text is a cut — when added, a `mentioned` event follows the same high-priority single-recipient path as `replied`.
- Distributed dedup is represented by a SQLite UNIQUE constraint; the prod mapping (DynamoDB conditional write / Redis SETNX / Bloom) is described, not implemented.
