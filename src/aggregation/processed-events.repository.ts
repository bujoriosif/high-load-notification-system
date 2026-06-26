import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../db/database';

/** Per-event idempotency guard for aggregatable events (likes/reposts). */
@Injectable()
export class ProcessedEventsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Returns true if this event was newly recorded, false if already processed. */
  markIfNew(eventId: string): boolean {
    return (
      this.db
        .prepare('INSERT OR IGNORE INTO processed_events (event_id) VALUES (?)')
        .run(eventId).changes > 0
    );
  }
}
