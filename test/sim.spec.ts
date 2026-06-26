import { planDelivery } from '../src/sim/delivery-plan';
import { bulkInsertNotifications } from '../src/sim/write-runner';
import { createDatabase } from '../src/db/database';
import { NotificationsRepository } from '../src/notifications/notifications.repository';

describe('delivery plan (smearing math)', () => {
  it('covers the total within the window', () => {
    const p = planDelivery(1000, 1000, 50000);
    expect(p.perTick * p.ticks).toBeGreaterThanOrEqual(1000);
    expect(p.requiredPerSec).toBe(1000);
    expect(p.impliedDurationMsAtCap).toBeCloseTo(20); // 1000 / 50000 * 1000
  });

  it('shows a rate cap stretching delivery past the window (flash crowd)', () => {
    const p = planDelivery(1_000_000, 10_000, 50_000);
    expect(p.requiredPerSec).toBe(100_000); // need 100k/s to fit 1M into 10s
    expect(p.impliedDurationMsAtCap).toBe(20_000); // but a 50k/s cap => 20s
  });

  it('terminates for tiny totals', () => {
    const p = planDelivery(5, 1000, 50000);
    expect(p.ticks).toBeGreaterThan(0);
    expect(p.perTick).toBeGreaterThanOrEqual(1);
  });
});

describe('write runner (fan-out-on-write)', () => {
  it('writes exactly the requested rows and is idempotent on rerun', () => {
    const db = createDatabase(':memory:');
    const first = bulkInsertNotifications(db, 'runX', 1000);
    const second = bulkInsertNotifications(db, 'runX', 1000); // same recipients + dedup key
    const repo = new NotificationsRepository(db);

    expect(first).toBe(1000);
    expect(second).toBe(0); // every row conflicts on (recipient, dedup_key)
    expect(repo.countForRecipient('sim:runX:0')).toBe(1);
  });
});
