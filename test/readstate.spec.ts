import { makeContext } from './helpers';

describe('read state', () => {
  it('marks a single materialized notification as read', () => {
    const ctx = makeContext(10);
    ctx.follows.addFollow('u1', 'normal', 1);
    ctx.orchestrator.handle({
      eventId: 'e1',
      type: 'post_created',
      actorId: 'normal',
      subjectId: 'p1',
      ts: 1000,
    });

    let page = ctx.feed.getFeed('u1');
    expect(page.items[0].read).toBe(false);
    const id = page.items[0].id;

    expect(ctx.feed.markRead(id)).toBe(true);
    page = ctx.feed.getFeed('u1');
    expect(page.items[0].read).toBe(true);
  });

  it('read-all advances the watermark so pulled celebrity items read as read', () => {
    const ctx = makeContext(10);
    for (let i = 0; i < 12; i++) ctx.follows.addFollow(`f${i}`, 'celeb', 100 + i);
    ctx.follows.addFollow('u1', 'celeb', 200);
    ctx.orchestrator.handle({
      eventId: 'c1',
      type: 'post_created',
      actorId: 'celeb',
      subjectId: 'pc',
      ts: 1000,
    });

    let page = ctx.feed.getFeed('u1');
    expect(page.items[0].read).toBe(false); // pulled celebrity item, unread

    ctx.feed.markAllRead('u1', 5000); // advance watermark past ts 1000
    page = ctx.feed.getFeed('u1');
    expect(page.items[0].read).toBe(true);
  });
});
