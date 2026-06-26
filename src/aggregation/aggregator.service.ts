import { Injectable } from '@nestjs/common';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { ProcessedEventsRepository } from './processed-events.repository';
import { newId } from '../common/ids';
import { NotificationRow } from '../common/types';

const ACTOR_SAMPLE_LIMIT = 3;

@Injectable()
export class AggregatorService {
  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly processed: ProcessedEventsRepository,
  ) {}

  /**
   * Collapse likes into one rollup notification per (recipient, subject). A per-event
   * guard stops a replayed like from double-counting. Returns true if the event had an
   * effect, false if it was a duplicate.
   */
  aggregateLike(
    recipientId: string,
    actorId: string,
    subjectId: string,
    eventId: string,
    ts: number,
  ): boolean {
    if (!this.processed.markIfNew(eventId)) {
      return false; // this like was already counted
    }
    const dedupKey = `agg:${subjectId}:like`;
    const existing = this.notifications.findByDedup(recipientId, dedupKey);
    if (existing) {
      this.notifications.incrementAggregate(existing.id, actorId, ts, ACTOR_SAMPLE_LIMIT);
      return true;
    }
    const row: NotificationRow = {
      id: newId(ts),
      recipient_id: recipientId,
      type: 'like_rollup',
      priority: 'best_effort',
      actor_id: actorId,
      subject_id: subjectId,
      created_at: ts,
      read_at: null,
      dedup_key: dedupKey,
      agg_count: 1,
      agg_actors: JSON.stringify([actorId]),
    };
    this.notifications.insertIfNew(row);
    return true;
  }
}
