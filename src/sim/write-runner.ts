import { Db } from '../db/database';
import { newId } from '../common/ids';

/**
 * Build a batched inserter for synthetic fan-out notifications. Each batch runs in one
 * transaction (fast). Recipients are `sim:{runId}:{i}` and share dedup_key `sim-{runId}`,
 * so rerunning the same runId is idempotent (every row conflicts on (recipient, dedup_key)).
 * Returns a function that inserts [start, end) and reports rows actually inserted.
 */
export function createBatchInserter(db: Db, runId: string): (start: number, end: number) => number {
  const stmt = db.prepare(
    `INSERT INTO notifications
       (id, recipient_id, type, priority, actor_id, subject_id, created_at, read_at, dedup_key, agg_count, agg_actors)
     VALUES (?, ?, 'post', 'best_effort', 'simAuthor', ?, ?, NULL, ?, 1, NULL)
     ON CONFLICT(recipient_id, dedup_key) DO NOTHING`,
  );
  const ts = Date.now();
  const dedupKey = `sim-${runId}`;
  const subject = `simpost:${runId}`;
  const tx = db.transaction((start: number, end: number) => {
    let inserted = 0;
    for (let i = start; i < end; i++) {
      inserted += stmt.run(newId(ts), `sim:${runId}:${i}`, subject, ts, dedupKey).changes as number;
    }
    return inserted;
  });
  return (start: number, end: number) => tx(start, end) as number;
}

/** Convenience for tests: insert `count` rows synchronously, return rows actually inserted. */
export function bulkInsertNotifications(db: Db, runId: string, count: number, batchSize = 5000): number {
  const insert = createBatchInserter(db, runId);
  let written = 0;
  for (let i = 0; i < count; i += batchSize) {
    written += insert(i, Math.min(i + batchSize, count));
  }
  return written;
}
