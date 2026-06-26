import 'reflect-metadata';
import { createDatabase } from '../db/database';
import { FollowsRepository } from '../follows/follows.repository';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { CelebrityPostsRepository } from '../celebrity/celebrity-posts.repository';
import { ProcessedEventsRepository } from '../aggregation/processed-events.repository';
import { WatermarkRepository } from '../feed/watermark.repository';
import { FanoutService } from '../fanout/fanout.service';
import { AggregatorService } from '../aggregation/aggregator.service';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { FeedService } from '../feed/feed.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { PushDispatcher } from '../push/push.dispatcher';

const THRESHOLD = 1000;

function build() {
  const db = createDatabase(':memory:');
  const follows = new FollowsRepository(db);
  const notifications = new NotificationsRepository(db);
  const celeb = new CelebrityPostsRepository(db);
  const processed = new ProcessedEventsRepository(db);
  const watermark = new WatermarkRepository(db);
  const realtime = new RealtimePublisher();
  const push = new PushDispatcher();
  const fanout = new FanoutService(follows, notifications, realtime, push);
  const aggregator = new AggregatorService(notifications, processed);
  const orchestrator = new OrchestratorService(
    THRESHOLD,
    follows,
    notifications,
    celeb,
    fanout,
    aggregator,
    realtime,
    push,
  );
  const feed = new FeedService(THRESHOLD, follows, notifications, celeb, watermark);
  return { orchestrator, feed, follows };
}

function main(): void {
  const { orchestrator, feed, follows } = build();
  let ts = Date.now();

  // normalAuthor has 3 followers; celeb has 1500 followers (above threshold).
  for (const f of ['u1', 'u2', 'u3']) follows.addFollow(f, 'normalAuthor', ts++);
  for (let i = 0; i < 1500; i++) follows.addFollow(`fan${i}`, 'celeb', ts++);
  // u1 also follows the celebrity, so their feed merges a pulled celebrity post.
  follows.addFollow('u1', 'celeb', ts++);

  console.log('normalAuthor follower_count:', follows.getFollowerCount('normalAuthor'));
  console.log('celeb follower_count       :', follows.getFollowerCount('celeb'));

  // Normal author posts -> fan-out-on-write to u1, u2, u3.
  orchestrator.handle({ eventId: 'e-post-1', type: 'post_created', actorId: 'normalAuthor', subjectId: 'postN', ts: ts++ });
  // Celebrity posts -> NO inbox blast; recorded as a pull source.
  orchestrator.handle({ eventId: 'e-post-2', type: 'post_created', actorId: 'celeb', subjectId: 'postC', ts: ts++ });

  // Likes on u1's post: same like replayed (deduped) + a second distinct liker.
  orchestrator.handle({ eventId: 'e-like-1', type: 'liked', actorId: 'x', subjectId: 'postU1', targetId: 'u1', ts: ts++ });
  orchestrator.handle({ eventId: 'e-like-1', type: 'liked', actorId: 'x', subjectId: 'postU1', targetId: 'u1', ts: ts++ }); // replay
  orchestrator.handle({ eventId: 'e-like-2', type: 'liked', actorId: 'y', subjectId: 'postU1', targetId: 'u1', ts: ts++ });

  console.log('\n--- u1 feed: normalAuthor post (inbox) + celeb post (pull) + like rollup ---');
  console.dir(feed.getFeed('u1'), { depth: null });

  console.log('\n--- u2 feed: only the normalAuthor inbox post (does not follow celeb) ---');
  console.dir(feed.getFeed('u2'), { depth: null });
}

main();
