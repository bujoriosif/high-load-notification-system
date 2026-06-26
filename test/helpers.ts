import 'reflect-metadata';
import { createDatabase, Db } from '../src/db/database';
import { FollowsRepository } from '../src/follows/follows.repository';
import { NotificationsRepository } from '../src/notifications/notifications.repository';
import { CelebrityPostsRepository } from '../src/celebrity/celebrity-posts.repository';
import { ProcessedEventsRepository } from '../src/aggregation/processed-events.repository';
import { WatermarkRepository } from '../src/feed/watermark.repository';
import { FanoutService } from '../src/fanout/fanout.service';
import { AggregatorService } from '../src/aggregation/aggregator.service';
import { OrchestratorService } from '../src/orchestrator/orchestrator.service';
import { FeedService } from '../src/feed/feed.service';
import { RealtimePublisher } from '../src/realtime/realtime.publisher';
import { PushDispatcher } from '../src/push/push.dispatcher';

export interface TestContext {
  db: Db;
  follows: FollowsRepository;
  notifications: NotificationsRepository;
  celeb: CelebrityPostsRepository;
  orchestrator: OrchestratorService;
  feed: FeedService;
}

/** Build a fully-wired stack against a fresh in-memory database. */
export function makeContext(threshold = 1000): TestContext {
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
    threshold,
    follows,
    notifications,
    celeb,
    fanout,
    aggregator,
    realtime,
    push,
  );
  const feed = new FeedService(threshold, follows, notifications, celeb, watermark);
  return { db, follows, notifications, celeb, orchestrator, feed };
}
