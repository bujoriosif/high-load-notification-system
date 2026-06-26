import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../db/database';

@Injectable()
export class FollowsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Idempotent: adding an existing follow does not double-count follower_count. */
  addFollow(followerId: string, followeeId: string, ts: number): void {
    this.db
      .prepare('INSERT OR IGNORE INTO users (id, follower_count) VALUES (?, 0)')
      .run(followerId);
    this.db
      .prepare('INSERT OR IGNORE INTO users (id, follower_count) VALUES (?, 0)')
      .run(followeeId);
    const info = this.db
      .prepare(
        'INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)',
      )
      .run(followerId, followeeId, ts);
    if (info.changes > 0) {
      this.db
        .prepare('UPDATE users SET follower_count = follower_count + 1 WHERE id = ?')
        .run(followeeId);
    }
  }

  getFollowerIds(userId: string): string[] {
    return (
      this.db
        .prepare('SELECT follower_id FROM follows WHERE followee_id = ?')
        .all(userId) as Array<{ follower_id: string }>
    ).map((r) => r.follower_id);
  }

  getFollowerCount(userId: string): number {
    const row = this.db
      .prepare('SELECT follower_count FROM users WHERE id = ?')
      .get(userId) as { follower_count: number } | undefined;
    return row?.follower_count ?? 0;
  }

  isCelebrity(userId: string, threshold: number): boolean {
    return this.getFollowerCount(userId) >= threshold;
  }

  /** Celebrities (follower_count >= threshold) that the given user follows — the pull sources. */
  getCelebrityFolloweeIds(userId: string, threshold: number): string[] {
    return (
      this.db
        .prepare(
          `SELECT f.followee_id AS id
           FROM follows f
           JOIN users u ON u.id = f.followee_id
           WHERE f.follower_id = ? AND u.follower_count >= ?`,
        )
        .all(userId, threshold) as Array<{ id: string }>
    ).map((r) => r.id);
  }
}
