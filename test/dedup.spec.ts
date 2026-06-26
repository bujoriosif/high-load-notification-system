import { makeContext } from './helpers';

describe('idempotent dedup', () => {
  it('reprocessing the same post event creates exactly one notification per follower', () => {
    const ctx = makeContext();
    ['a', 'b', 'c'].forEach((f, i) => ctx.follows.addFollow(f, 'author', 1000 + i));

    const event = {
      eventId: 'evt-1',
      type: 'post_created' as const,
      actorId: 'author',
      subjectId: 'p1',
      ts: 2000,
    };
    const first = ctx.orchestrator.handle(event);
    const second = ctx.orchestrator.handle(event); // replay

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(ctx.notifications.countForRecipient('a')).toBe(1);
    expect(ctx.notifications.countForRecipient('b')).toBe(1);
    expect(ctx.notifications.countForRecipient('c')).toBe(1);
  });

  it('a partially-applied fan-out completes on replay without duplicating', () => {
    const ctx = makeContext();
    ['a', 'b'].forEach((f, i) => ctx.follows.addFollow(f, 'author', 1000 + i));

    // Simulate a crash mid-fan-out: 'a' already received the notification.
    ctx.notifications.insertIfNew({
      id: 'pre',
      recipient_id: 'a',
      type: 'post',
      priority: 'best_effort',
      actor_id: 'author',
      subject_id: 'p1',
      created_at: 2000,
      read_at: null,
      dedup_key: 'evt-1',
      agg_count: 1,
      agg_actors: null,
    });

    ctx.orchestrator.handle({
      eventId: 'evt-1',
      type: 'post_created',
      actorId: 'author',
      subjectId: 'p1',
      ts: 2000,
    });

    expect(ctx.notifications.countForRecipient('a')).toBe(1); // not duplicated
    expect(ctx.notifications.countForRecipient('b')).toBe(1); // filled in
  });

  it('a replayed like does not double-count the rollup', () => {
    const ctx = makeContext();
    const like = {
      eventId: 'like-1',
      type: 'liked' as const,
      actorId: 'x',
      subjectId: 'p1',
      targetId: 'owner',
      ts: 3000,
    };
    ctx.orchestrator.handle(like);
    ctx.orchestrator.handle(like); // replay
    ctx.orchestrator.handle({
      eventId: 'like-2',
      type: 'liked',
      actorId: 'y',
      subjectId: 'p1',
      targetId: 'owner',
      ts: 3001,
    });

    const page = ctx.feed.getFeed('owner');
    const rollup = page.items.find((i) => i.type === 'like_rollup');
    expect(rollup).toBeDefined();
    expect(rollup!.aggCount).toBe(2); // x counted once (replay ignored) + y
  });
});
