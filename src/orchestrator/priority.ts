import { EventType, NotificationType, Priority } from '../common/types';

export function notificationTypeFor(event: EventType): NotificationType {
  switch (event) {
    case 'post_created':
      return 'post';
    case 'replied':
      return 'reply';
    case 'followed':
      return 'follow';
    case 'liked':
      return 'like_rollup';
    default:
      throw new Error(`unhandled event type: ${event as string}`);
  }
}

export function priorityFor(event: EventType): Priority {
  // Personal, low-fan-out events are high priority; high-volume / aggregatable are best-effort.
  if (event === 'replied' || event === 'followed') return 'high';
  return 'best_effort';
}
