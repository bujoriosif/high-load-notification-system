import { Inject, Injectable } from '@nestjs/common';
import { CELEBRITY_THRESHOLD } from '../db/database';
import { FeedItem } from '../common/types';
import { FollowsRepository } from '../follows/follows.repository';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { CelebrityPostsRepository } from '../celebrity/celebrity-posts.repository';
import { WatermarkRepository } from './watermark.repository';
import { decodeCursor, encodeCursor } from '../common/cursor';

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class FeedService {
  constructor(
    @Inject(CELEBRITY_THRESHOLD) private readonly threshold: number,
    private readonly follows: FollowsRepository,
    private readonly notifications: NotificationsRepository,
    private readonly celebrityPosts: CelebrityPostsRepository,
    private readonly watermark: WatermarkRepository,
  ) {}

  /**
   * Newest-first, cursor-paginated feed that merges the materialized inbox with recent
   * posts from followed celebrities (the pull source). Each source is queried with the
   * same composite cursor, then k-way merged — so paging is stable and never skips items.
   */
  getFeed(userId: string, rawCursor?: string | null, rawLimit?: number): FeedPage {
    const limit = Math.min(Math.max(rawLimit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const cursor = decodeCursor(rawCursor);

    const inbox = this.notifications.getInboxPage(userId, cursor, limit);
    const celebIds = this.follows.getCelebrityFolloweeIds(userId, this.threshold);
    const celebPosts = this.celebrityPosts.getRecentByAuthors(celebIds, cursor, limit);
    const wm = this.watermark.get(userId);

    const inboxItems: FeedItem[] = inbox.map((r) => ({
      id: r.id,
      type: r.type,
      actorId: r.actor_id,
      subjectId: r.subject_id,
      createdAt: r.created_at,
      read: r.read_at !== null,
      aggCount: r.agg_count,
      aggActors: r.agg_actors ? JSON.parse(r.agg_actors) : [],
    }));

    const celebItems: FeedItem[] = celebPosts.map((p) => ({
      id: p.id,
      type: 'post',
      actorId: p.author_id,
      subjectId: p.id,
      createdAt: p.created_at,
      read: wm !== null && p.created_at <= wm,
      aggCount: 1,
      aggActors: [],
    }));

    const merged = [...inboxItems, ...celebItems].sort(compareDesc);
    const items = merged.slice(0, limit);

    // More may exist if either source filled its page, or the merge overflowed.
    const hasMore = merged.length > limit || inbox.length === limit || celebPosts.length === limit;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

    return { items, nextCursor };
  }

  markRead(notificationId: string, ts = Date.now()): boolean {
    return this.notifications.markRead(notificationId, ts);
  }

  markAllRead(userId: string, ts = Date.now()): number {
    const count = this.notifications.markAllRead(userId, ts);
    this.watermark.advance(userId, ts);
    return count;
  }
}

/** Newest-first ordering: higher createdAt first, id as a stable tiebreak. */
function compareDesc(a: FeedItem, b: FeedItem): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}
