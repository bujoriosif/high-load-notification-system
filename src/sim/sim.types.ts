export type SimStrategy = 'write' | 'realtime' | 'both';
export type RunStatus = 'running' | 'done' | 'error';

export interface SimParams {
  total: number;
  strategy: SimStrategy;
  windowMs: number;
  ratePerSec: number; // gateway cap, used for the "implied duration" insight
  writeCap: number;
}

export interface StrategyProgress {
  strategy: 'write' | 'realtime';
  sent: number;
  target: number; // write: min(total, writeCap); realtime: total
  pct: number;
  throughputPerSec: number;
  elapsedMs: number;
  etaMs: number | null;
  durableRows: number;
  note?: string; // human-readable insight (filled on completion)
}

export interface SimProgress {
  type: 'progress' | 'done' | 'error';
  runId: string;
  status: RunStatus;
  params: SimParams;
  write?: StrategyProgress;
  realtime?: StrategyProgress;
  message?: string;
}
