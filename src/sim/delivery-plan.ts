export interface DeliveryPlan {
  tickMs: number;
  ticks: number;
  perTick: number; // base deliveries per tick (jitter applied at playback; last tick clamps to total)
  effectiveDurationMs: number;
  requiredPerSec: number; // throughput needed to deliver `total` within the window
  impliedDurationMsAtCap: number; // how long delivery actually takes if capped at ratePerSec
}

/**
 * Plan a smeared delivery: spread `total` pushes across the window in fixed ticks.
 * Pure and deterministic so the schedule can be unit-tested; playback adds jitter.
 */
export function planDelivery(
  total: number,
  windowMs: number,
  ratePerSec: number,
  tickMs = 100,
): DeliveryPlan {
  const effectiveDurationMs = Math.max(windowMs, tickMs);
  const ticks = Math.max(1, Math.round(effectiveDurationMs / tickMs));
  const perTick = Math.max(1, Math.ceil(total / ticks));
  const requiredPerSec = total / (effectiveDurationMs / 1000);
  const impliedDurationMsAtCap = ratePerSec > 0 ? (total / ratePerSec) * 1000 : Infinity;
  return { tickMs, ticks, perTick, effectiveDurationMs, requiredPerSec, impliedDurationMsAtCap };
}
