import { Inject, Injectable } from '@nestjs/common';
import { DB, Db } from '../db/database';
import { newId } from '../common/ids';
import { SimRunStore } from './sim-run.store';
import { createBatchInserter } from './write-runner';
import { planDelivery } from './delivery-plan';
import { RunStatus, SimParams, SimProgress, StrategyProgress } from './sim.types';

const WRITE_BATCH = 5000;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
const round = (n: number): number => Math.round(n);

interface RunState {
  write?: StrategyProgress;
  realtime?: StrategyProgress;
}

@Injectable()
export class SimulatorService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly store: SimRunStore,
  ) {}

  /** Create a run and kick off execution asynchronously; returns its id immediately. */
  start(params: SimParams): string {
    const runId = newId();
    const initial: SimProgress = { type: 'progress', runId, status: 'running', params };
    this.store.create(runId, params, initial);
    void this.execute(runId, params);
    return runId;
  }

  private async execute(runId: string, params: SimParams): Promise<void> {
    const state: RunState = {};
    const publish = (type: 'progress' | 'done', status: RunStatus): void => {
      const snapshot: SimProgress = { type, runId, status, params, write: state.write, realtime: state.realtime };
      if (type === 'done') this.store.complete(runId, snapshot);
      else this.store.update(runId, snapshot);
    };

    try {
      if (params.strategy === 'write' || params.strategy === 'both') {
        await this.runWrite(runId, params, state, () => publish('progress', 'running'));
      }
      if (params.strategy === 'realtime' || params.strategy === 'both') {
        await this.runRealtime(params, state, () => publish('progress', 'running'));
      }
      publish('done', 'done');
    } catch (err) {
      this.store.complete(runId, {
        type: 'error',
        runId,
        status: 'error',
        params,
        write: state.write,
        realtime: state.realtime,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Fan-out-on-write: insert real rows up to writeCap, then extrapolate to the full total. */
  private async runWrite(
    runId: string,
    params: SimParams,
    state: RunState,
    onProgress: () => void,
  ): Promise<void> {
    const target = Math.min(params.total, params.writeCap);
    const insert = createBatchInserter(this.db, runId);
    const start = Date.now();
    let processed = 0;
    let written = 0;

    for (let i = 0; i < target; i += WRITE_BATCH) {
      const end = Math.min(i + WRITE_BATCH, target);
      written += insert(i, end);
      processed = end;
      const elapsedMs = Date.now() - start;
      const throughputPerSec = elapsedMs > 0 ? (processed / elapsedMs) * 1000 : processed;
      state.write = {
        strategy: 'write',
        sent: processed,
        target,
        pct: target > 0 ? processed / target : 1,
        throughputPerSec: round(throughputPerSec),
        elapsedMs,
        etaMs: throughputPerSec > 0 ? round(((target - processed) / throughputPerSec) * 1000) : null,
        durableRows: written,
      };
      onProgress();
      await tick(); // yield so the SSE frame flushes mid-run
    }

    const elapsedMs = Math.max(1, Date.now() - start);
    const rowsPerSec = (written / elapsedMs) * 1000;
    const projectedMsForTotal = round((params.total / Math.max(1, written)) * elapsedMs);
    state.write = {
      strategy: 'write',
      sent: target,
      target,
      pct: 1,
      throughputPerSec: round(rowsPerSec),
      elapsedMs,
      etaMs: 0,
      durableRows: written,
      note:
        `Wrote ${written.toLocaleString()} durable rows in ${elapsedMs}ms (~${round(rowsPerSec).toLocaleString()}/s). ` +
        `Full ${params.total.toLocaleString()} ⇒ ~${projectedMsForTotal.toLocaleString()}ms and ${params.total.toLocaleString()} durable rows.`,
    };
    onProgress();
  }

  /** Real-time delivery: smear `total` pushes over the window with jitter; report live throughput. */
  private async runRealtime(
    params: SimParams,
    state: RunState,
    onProgress: () => void,
  ): Promise<void> {
    const plan = planDelivery(params.total, params.windowMs, params.ratePerSec);
    const start = Date.now();
    let sent = 0;

    for (let t = 0; t < plan.ticks && sent < params.total; t++) {
      await delay(plan.tickMs);
      const jitter = 0.5 + Math.random(); // 0.5x..1.5x
      const inc = Math.min(params.total - sent, Math.max(1, round(plan.perTick * jitter)));
      sent += inc;
      const elapsedMs = Date.now() - start;
      const throughputPerSec = elapsedMs > 0 ? (sent / elapsedMs) * 1000 : sent;
      state.realtime = {
        strategy: 'realtime',
        sent,
        target: params.total,
        pct: params.total > 0 ? sent / params.total : 1,
        throughputPerSec: round(throughputPerSec),
        elapsedMs,
        etaMs: throughputPerSec > 0 ? round(((params.total - sent) / throughputPerSec) * 1000) : null,
        durableRows: 0,
      };
      onProgress();
    }

    const elapsedMs = Math.max(1, Date.now() - start);
    state.realtime = {
      strategy: 'realtime',
      sent: params.total,
      target: params.total,
      pct: 1,
      throughputPerSec: round((params.total / elapsedMs) * 1000),
      elapsedMs,
      etaMs: 0,
      durableRows: 0,
      note:
        `Delivered ${params.total.toLocaleString()} pushes smeared over ${params.windowMs}ms ` +
        `(needs ~${round(plan.requiredPerSec).toLocaleString()}/s). At a ${params.ratePerSec.toLocaleString()}/s gateway cap, ` +
        `real delivery would take ~${round(plan.impliedDurationMsAtCap).toLocaleString()}ms — and 0 durable rows.`,
    };
    onProgress();
  }
}
