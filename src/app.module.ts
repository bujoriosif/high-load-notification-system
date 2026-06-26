import { Module } from '@nestjs/common';
import { createDatabase, DB, CELEBRITY_THRESHOLD } from './db/database';
import { FollowsRepository } from './follows/follows.repository';
import { NotificationsRepository } from './notifications/notifications.repository';
import { CelebrityPostsRepository } from './celebrity/celebrity-posts.repository';
import { ProcessedEventsRepository } from './aggregation/processed-events.repository';
import { WatermarkRepository } from './feed/watermark.repository';
import { FanoutService } from './fanout/fanout.service';
import { AggregatorService } from './aggregation/aggregator.service';
import { OrchestratorService } from './orchestrator/orchestrator.service';
import { FeedService } from './feed/feed.service';
import { RealtimePublisher } from './realtime/realtime.publisher';
import { PushDispatcher } from './push/push.dispatcher';
import { EventsController } from './events/events.controller';
import { FeedController } from './feed/feed.controller';
import { SimController } from './sim/sim.controller';
import { SimulatorService } from './sim/simulator.service';
import { SimRunStore } from './sim/sim-run.store';

@Module({
  controllers: [EventsController, FeedController, SimController],
  providers: [
    { provide: DB, useFactory: () => createDatabase(process.env.DB_PATH ?? ':memory:') },
    {
      provide: CELEBRITY_THRESHOLD,
      useFactory: () => Number(process.env.CELEBRITY_THRESHOLD ?? 1000),
    },
    FollowsRepository,
    NotificationsRepository,
    CelebrityPostsRepository,
    ProcessedEventsRepository,
    WatermarkRepository,
    FanoutService,
    AggregatorService,
    OrchestratorService,
    FeedService,
    RealtimePublisher,
    PushDispatcher,
    SimulatorService,
    SimRunStore,
  ],
})
export class AppModule {}
