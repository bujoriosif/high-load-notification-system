import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { SimParams, SimProgress } from './sim.types';

export interface SimRun {
  id: string;
  params: SimParams;
  snapshot: SimProgress;
  subject: Subject<SimProgress>;
}

/** In-memory registry of (ephemeral) simulation runs and their live progress streams. */
@Injectable()
export class SimRunStore {
  private readonly runs = new Map<string, SimRun>();

  create(id: string, params: SimParams, initial: SimProgress): SimRun {
    const run: SimRun = { id, params, snapshot: initial, subject: new Subject<SimProgress>() };
    this.runs.set(id, run);
    return run;
  }

  get(id: string): SimRun | undefined {
    return this.runs.get(id);
  }

  /** Push a live update to subscribers. */
  update(id: string, snapshot: SimProgress): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.snapshot = snapshot;
    run.subject.next(snapshot);
  }

  /** Final update, then close the stream. */
  complete(id: string, snapshot: SimProgress): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.snapshot = snapshot;
    run.subject.next(snapshot);
    run.subject.complete();
  }
}
