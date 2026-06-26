import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../db/database';
import { Cursor } from '../common/types';

export interface CelebrityPost {
  id: string;
  author_id: string;
  created_at: number;
}

@Injectable()
export class CelebrityPostsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Record a celebrity post as a pull source. Idempotent on post id. Returns true if inserted. */
  addPost(id: string, authorId: string, createdAt: number): boolean {
    return (
      this.db
        .prepare('INSERT OR IGNORE INTO celebrity_posts (id, author_id, created_at) VALUES (?, ?, ?)')
        .run(id, authorId, createdAt).changes > 0
    );
  }

  getRecentByAuthors(
    authorIds: string[],
    cursor: Cursor | undefined,
    limit: number,
  ): CelebrityPost[] {
    if (authorIds.length === 0) return [];
    const placeholders = authorIds.map(() => '?').join(',');
    if (cursor) {
      return this.db
        .prepare(
          `SELECT * FROM celebrity_posts
           WHERE author_id IN (${placeholders})
             AND (created_at < ? OR (created_at = ? AND id < ?))
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
        )
        .all(...authorIds, cursor.createdAt, cursor.createdAt, cursor.id, limit) as CelebrityPost[];
    }
    return this.db
      .prepare(
        `SELECT * FROM celebrity_posts
         WHERE author_id IN (${placeholders})
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(...authorIds, limit) as CelebrityPost[];
  }
}
