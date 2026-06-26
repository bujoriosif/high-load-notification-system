import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../db/database';
import { Cursor, NotificationRow } from '../common/types';

@Injectable()
export class NotificationsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Insert, deduped by (recipient_id, dedup_key). Returns true if a new row was created. */
  insertIfNew(row: NotificationRow): boolean {
    const info = this.db
      .prepare(
        `INSERT INTO notifications
           (id, recipient_id, type, priority, actor_id, subject_id, created_at, read_at, dedup_key, agg_count, agg_actors)
         VALUES
           (@id, @recipient_id, @type, @priority, @actor_id, @subject_id, @created_at, @read_at, @dedup_key, @agg_count, @agg_actors)
         ON CONFLICT(recipient_id, dedup_key) DO NOTHING`,
      )
      .run(row);
    return info.changes > 0;
  }

  findByDedup(recipientId: string, dedupKey: string): NotificationRow | undefined {
    return this.db
      .prepare('SELECT * FROM notifications WHERE recipient_id = ? AND dedup_key = ?')
      .get(recipientId, dedupKey) as NotificationRow | undefined;
  }

  /** Bump an existing aggregate: +1 count, prepend actor to a bounded sample, resurface as unread. */
  incrementAggregate(id: string, actorId: string, ts: number, sampleLimit: number): void {
    const current = this.db
      .prepare('SELECT agg_actors FROM notifications WHERE id = ?')
      .get(id) as { agg_actors: string | null } | undefined;
    const actors: string[] = current?.agg_actors ? JSON.parse(current.agg_actors) : [];
    actors.unshift(actorId);
    const trimmed = actors.slice(0, sampleLimit);
    this.db
      .prepare(
        `UPDATE notifications
         SET agg_count = agg_count + 1, agg_actors = ?, created_at = ?, read_at = NULL
         WHERE id = ?`,
      )
      .run(JSON.stringify(trimmed), ts, id);
  }

  getInboxPage(recipientId: string, cursor: Cursor | undefined, limit: number): NotificationRow[] {
    if (cursor) {
      return this.db
        .prepare(
          `SELECT * FROM notifications
           WHERE recipient_id = ?
             AND (created_at < ? OR (created_at = ? AND id < ?))
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
        )
        .all(recipientId, cursor.createdAt, cursor.createdAt, cursor.id, limit) as NotificationRow[];
    }
    return this.db
      .prepare(
        `SELECT * FROM notifications
         WHERE recipient_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(recipientId, limit) as NotificationRow[];
  }

  markRead(id: string, ts: number): boolean {
    const info = this.db
      .prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL')
      .run(ts, id);
    return info.changes > 0;
  }

  markAllRead(recipientId: string, ts: number): number {
    return this.db
      .prepare('UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL')
      .run(ts, recipientId).changes as number;
  }

  countForRecipient(recipientId: string): number {
    return (
      this.db
        .prepare('SELECT COUNT(*) AS c FROM notifications WHERE recipient_id = ?')
        .get(recipientId) as { c: number }
    ).c;
  }
}
