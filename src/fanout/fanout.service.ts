import { Injectable } from '@nestjs/common';
import { FollowsRepository } from '../follows/follows.repository';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { PushDispatcher } from '../push/push.dispatcher';
import { newId } from '../common/ids';
import { NotificationRow } from '../common/types';

@Injectable()
export class FanoutService {
  constructor(
    private readonly follows: FollowsRepository,
    private readonly notifications: NotificationsRepository,
    private readonly realtime: RealtimePublisher,
    private readonly push: PushDispatcher,
  ) {}

  /**
   * Fan-out-on-write for a normal author's post: one dedup-guarded notification per
   * follower, keyed by (recipient, eventId) so reprocessing — including a partial,
   * crashed fan-out — is idempotent. Returns the count of notifications newly created.
   * // TODO: in prod this is a queue + worker fleet, chunked over the follower list.
   */
  fanoutPost(authorId: string, postId: string, eventId: string, ts: number): number {
    const followers = this.follows.getFollowerIds(authorId);
    let inserted = 0;
    for (const followerId of followers) {
      const row: NotificationRow = {
        id: newId(ts),
        recipient_id: followerId,
        type: 'post',
        priority: 'best_effort',
        actor_id: authorId,
        subject_id: postId,
        created_at: ts,
        read_at: null,
        dedup_key: eventId,
        agg_count: 1,
        agg_actors: null,
      };
      if (this.notifications.insertIfNew(row)) {
        inserted++;
        const payload = { type: 'post', actorId: authorId, postId };
        this.realtime.pushToUser(followerId, payload);
        this.push.dispatch(followerId, payload);
      }
    }
    return inserted;
  }
}
