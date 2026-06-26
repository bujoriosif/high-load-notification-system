import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../db/database';

/**
 * Read-state for pull (celebrity) items, which have no materialized row to flag.
 * A per-user watermark marks everything created at or before it as read.
 */
@Injectable()
export class WatermarkRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  get(userId: string): number | null {
    const row = this.db
      .prepare('SELECT watermark FROM pull_read_watermark WHERE user_id = ?')
      .get(userId) as { watermark: number } | undefined;
    return row ? row.watermark : null;
  }

  /** Advance the watermark; never moves backwards. */
  advance(userId: string, ts: number): void {
    this.db
      .prepare(
        `INSERT INTO pull_read_watermark (user_id, watermark) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET watermark = MAX(watermark, excluded.watermark)`,
      )
      .run(userId, ts);
  }
}
