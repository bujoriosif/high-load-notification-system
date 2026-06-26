import { makeContext } from './helpers';

describe('hybrid fan-out routing', () => {
  it('a normal author writes a notification to every follower', () => {
    const ctx = makeContext(1000);
    for (let i = 0; i < 5; i++) ctx.follows.addFollow(`f${i}`, 'normal', 1000 + i);

    ctx.orchestrator.handle({
      eventId: 'e1',
      type: 'post_created',
      actorId: 'normal',
      subjectId: 'p1',
      ts: 2000,
    });

    for (let i = 0; i < 5; i++) {
      expect(ctx.notifications.countForRecipient(`f${i}`)).toBe(1);
    }
  });

  it('a celebrity author writes ZERO inbox rows and records one pull source', () => {
    const ctx = makeContext(10); // low threshold: 12 followers => celebrity
    for (let i = 0; i < 12; i++) ctx.follows.addFollow(`f${i}`, 'celeb', 1000 + i);

    ctx.orchestrator.handle({
      eventId: 'e1',
      type: 'post_created',
      actorId: 'celeb',
      subjectId: 'pc',
      ts: 2000,
    });

    for (let i = 0; i < 12; i++) {
      expect(ctx.notifications.countForRecipient(`f${i}`)).toBe(0);
    }
    const posts = ctx.celeb.getRecentByAuthors(['celeb'], undefined, 10);
    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe('pc');
  });
});
