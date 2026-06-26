import { Injectable, Logger } from '@nestjs/common';

/**
 * STUB. In production this publishes to the real-time WebSocket gateway:
 *  - normal authors: direct push to a connected recipient
 *  - celebrity authors: publish ONCE to topic author:{id}, delivered to connected followers
 * // TODO: replace with API Gateway WebSocket / self-managed WS fleet + presence service.
 */
@Injectable()
export class RealtimePublisher {
  private readonly logger = new Logger(RealtimePublisher.name);

  pushToUser(userId: string, payload: unknown): void {
    this.logger.debug(`[realtime] push to ${userId}: ${JSON.stringify(payload)}`);
  }

  publishToTopic(authorId: string, payload: unknown): void {
    this.logger.debug(`[realtime] publish author:${authorId}: ${JSON.stringify(payload)}`);
  }
}
