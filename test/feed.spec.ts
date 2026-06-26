import { makeContext } from './helpers';

describe('merged feed + pagination', () => {
  it('merges inbox and celebrity-pull items newest-first', () => {
    const ctx = makeContext(10);
    // celeb has 12 followers => celebrity; reader u1 also follows celeb + a normal author
    for (let i = 0; i < 12; i++) ctx.follows.addFollow(`f${i}`, 'celeb', 100 + i);
    ctx.follows.addFollow('u1', 'celeb', 200);
    ctx.follows.addFollow('u1', 'normal', 201);

    // normal author's post -> u1 inbox at ts 1000
    ctx.orchestrator.handle({
      eventId: 'n1',
      type: 'post_created',
      actorId: 'normal',
      subjectId: 'pn',
      ts: 1000,
    });
    // celebrity post (pull source) at ts 2000 -> newer
    ctx.orchestrator.handle({
      eventId: 'c1',
      type: 'post_created',
      actorId: 'celeb',
      subjectId: 'pc',
      ts: 2000,
    });

    const page = ctx.feed.getFeed('u1');
    expect(page.items.map((i) => i.subjectId)).toEqual(['pc', 'pn']);
  });

  it('paginates with a stable, non-overlapping cursor', () => {
    const ctx = makeContext(10);
    ctx.follows.addFollow('u1', 'normal', 1); // normal: 1 follower, not a celebrity
    for (let i = 0; i < 5; i++) {
      ctx.orchestrator.handle({
        eventId: `e${i}`,
        type: 'post_created',
        actorId: 'normal',
        subjectId: `p${i}`,
        ts: 1000 + i,
      });
    }

    const p1 = ctx.feed.getFeed('u1', null, 2);
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = ctx.feed.getFeed('u1', p1.nextCursor, 2);
    const p3 = ctx.feed.getFeed('u1', p2.nextCursor, 2);

    const ids = [...p1.items, ...p2.items, ...p3.items].map((i) => i.subjectId);
    expect(new Set(ids).size).toBe(5); // no overlap
    expect(ids).toEqual(['p4', 'p3', 'p2', 'p1', 'p0']); // newest-first across pages
  });
});
