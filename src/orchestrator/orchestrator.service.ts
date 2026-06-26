import { Inject, Injectable } from '@nestjs/common';
import { CELEBRITY_THRESHOLD } from '../db/database';
import { DomainEvent, NotificationRow } from '../common/types';
import { FollowsRepository } from '../follows/follows.repository';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { CelebrityPostsRepository } from '../celebrity/celebrity-posts.repository';
import { FanoutService } from '../fanout/fanout.service';
import { AggregatorService } from '../aggregation/aggregator.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { PushDispatcher } from '../push/push.dispatcher';
import { newId } from '../common/ids';
import { notificationTypeFor, priorityFor } from './priority';

export interface IngestResult {
  accepted: true;
  deduped: boolean;
}

@Injectable()
export class OrchestratorService {
  constructor(
    @Inject(CELEBRITY_THRESHOLD) private readonly threshold: number,
    private readonly follows: FollowsRepository,
    private readonly notifications: NotificationsRepository,
    private readonly celebrityPosts: CelebrityPostsRepository,
    private readonly fanout: FanoutService,
    private readonly aggregator: AggregatorService,
    private readonly realtime: RealtimePublisher,
    private readonly push: PushDispatcher,
  ) {}

  handle(event: DomainEvent): IngestResult {
    const ts = event.ts ?? Date.now();
    switch (event.type) {
      case 'post_created':
        return this.handlePost(event, ts);
      case 'liked':
        return this.handleLike(event, ts);
      case 'replied':
        return this.handlePersonal(event, ts);
      case 'followed':
        return this.handleFollow(event, ts);
      default:
        return { accepted: true, deduped: false };
    }
  }

  /** Hybrid decision: normal author ⇒ fan-out-on-write; celebrity ⇒ pull source + topic push. */
  private handlePost(event: DomainEvent, ts: number): IngestResult {
    const authorId = event.actorId;
    const postId = event.subjectId!;
    if (this.follows.isCelebrity(authorId, this.threshold)) {
      const inserted = this.celebrityPosts.addPost(postId, authorId, ts);
      if (inserted) {
        this.realtime.publishToTopic(authorId, { type: 'post', authorId, postId });
      }
      return { accepted: true, deduped: !inserted };
    }
    const created = this.fanout.fanoutPost(authorId, postId, event.eventId, ts);
    return { accepted: true, deduped: created === 0 };
  }

  private handleLike(event: DomainEvent, ts: number): IngestResult {
    const effected = this.aggregator.aggregateLike(
      event.targetId!,
      event.actorId,
      event.subjectId!,
      event.eventId,
      ts,
    );
    return { accepted: true, deduped: !effected };
  }

  private handlePersonal(event: DomainEvent, ts: number): IngestResult {
    const recipientId = event.targetId!;
    const inserted = this.notifications.insertIfNew({
      id: newId(ts),
      recipient_id: recipientId,
      type: notificationTypeFor(event.type),
      priority: priorityFor(event.type),
      actor_id: event.actorId,
      subject_id: event.subjectId ?? null,
      created_at: ts,
      read_at: null,
      dedup_key: event.eventId,
      agg_count: 1,
      agg_actors: null,
    });
    if (inserted) {
      const payload = { type: notificationTypeFor(event.type), actorId: event.actorId };
      this.realtime.pushToUser(recipientId, payload);
      this.push.dispatch(recipientId, payload);
    }
    return { accepted: true, deduped: !inserted };
  }

  private handleFollow(event: DomainEvent, ts: number): IngestResult {
    const followeeId = event.targetId!;
    this.follows.addFollow(event.actorId, followeeId, ts);
    const row: NotificationRow = {
      id: newId(ts),
      recipient_id: followeeId,
      type: 'follow',
      priority: 'high',
      actor_id: event.actorId,
      subject_id: null,
      created_at: ts,
      read_at: null,
      dedup_key: event.eventId,
      agg_count: 1,
      agg_actors: null,
    };
    const inserted = this.notifications.insertIfNew(row);
    if (inserted) {
      const payload = { type: 'follow', actorId: event.actorId };
      this.realtime.pushToUser(followeeId, payload);
      this.push.dispatch(followeeId, payload);
    }
    return { accepted: true, deduped: !inserted };
  }
}
