import { Body, Controller, Get, NotFoundException, Param, Post, Sse } from '@nestjs/common';
import { Observable, concat, map, of } from 'rxjs';
import { SimulatorService } from './simulator.service';
import { SimRunStore } from './sim-run.store';
import { StartRunDto } from './start-run.dto';
import { SimProgress } from './sim.types';

@Controller('sim')
export class SimController {
  constructor(
    private readonly sim: SimulatorService,
    private readonly store: SimRunStore,
  ) {}

  @Post('run')
  start(@Body() dto: StartRunDto): { runId: string } {
    const runId = this.sim.start({
      total: dto.total,
      strategy: dto.strategy,
      windowMs: dto.windowMs ?? 10_000,
      ratePerSec: dto.ratePerSec ?? 50_000,
      writeCap: dto.writeCap ?? 100_000,
    });
    return { runId };
  }

  @Get('runs/:id')
  snapshot(@Param('id') id: string): SimProgress {
    const run = this.store.get(id);
    if (!run) throw new NotFoundException(`run ${id} not found`);
    return run.snapshot;
  }

  /** Emit the current snapshot, then stream live updates until the run completes. */
  @Sse('watch/:id')
  watch(@Param('id') id: string): Observable<{ data: SimProgress }> {
    const run = this.store.get(id);
    if (!run) throw new NotFoundException(`run ${id} not found`);
    return concat(of(run.snapshot), run.subject.asObservable()).pipe(map((data) => ({ data })));
  }
}
