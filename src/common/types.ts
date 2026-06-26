export type EventType = 'post_created' | 'liked' | 'replied' | 'followed';
export type NotificationType = 'post' | 'reply' | 'follow' | 'like_rollup';
export type Priority = 'high' | 'best_effort';

/** A domain event entering the system via POST /events. `eventId` is the idempotency anchor. */
export interface DomainEvent {
  eventId: string;
  type: EventType;
  actorId: string;
  /** Entity the event is about (e.g. the post id). */
  subjectId?: string;
  /** Recipient for personal/aggregatable events (post owner, followee). */
  targetId?: string;
  /** Epoch milliseconds. */
  ts: number;
}

/** A materialized inbox row (snake_case to mirror the SQLite columns). */
export interface NotificationRow {
  id: string;
  recipient_id: string;
  type: NotificationType;
  priority: Priority;
  actor_id: string | null;
  subject_id: string | null;
  created_at: number;
  read_at: number | null;
  dedup_key: string;
  agg_count: number;
  agg_actors: string | null; // JSON array of actor ids
}

/** The shape returned to clients in a feed page. */
export interface FeedItem {
  id: string;
  type: NotificationType;
  actorId: string | null;
  subjectId: string | null;
  createdAt: number;
  read: boolean;
  aggCount: number;
  aggActors: string[];
}

/** Composite, stable pagination cursor. */
export interface Cursor {
  createdAt: number;
  id: string;
}
