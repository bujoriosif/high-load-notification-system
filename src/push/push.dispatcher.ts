import { Injectable, Logger } from '@nestjs/common';

/**
 * STUB. In production this dispatches mobile push via SNS Mobile Push → APNs/FCM,
 * rate-limited and best-effort for celebrity fan-out.
 * // TODO: replace with device-token store + SNS Mobile Push dispatcher.
 */
@Injectable()
export class PushDispatcher {
  private readonly logger = new Logger(PushDispatcher.name);

  dispatch(userId: string, payload: unknown): void {
    this.logger.debug(`[push] to ${userId}: ${JSON.stringify(payload)}`);
  }
}
