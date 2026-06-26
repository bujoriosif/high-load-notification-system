import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { FeedPage, FeedService } from './feed.service';

@Controller()
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get('users/:id/notifications')
  getFeed(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): FeedPage {
    return this.feed.getFeed(id, cursor, limit ? Number(limit) : undefined);
  }

  @Post('notifications/:id/read')
  markRead(@Param('id') id: string): { ok: boolean } {
    return { ok: this.feed.markRead(id) };
  }

  @Post('users/:id/notifications/read-all')
  markAllRead(@Param('id') id: string): { ok: boolean; count: number } {
    return { ok: true, count: this.feed.markAllRead(id) };
  }
}
