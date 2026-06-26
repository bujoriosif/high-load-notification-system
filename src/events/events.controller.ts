import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { IngestEventDto } from './ingest-event.dto';
import { DomainEvent } from '../common/types';

@Controller('events')
export class EventsController {
  constructor(private readonly orchestrator: OrchestratorService) {}

  @Post()
  @HttpCode(202)
  ingest(@Body() dto: IngestEventDto): { status: string; deduped: boolean } {
    const event: DomainEvent = {
      eventId: dto.eventId,
      type: dto.type,
      actorId: dto.actorId,
      subjectId: dto.subjectId,
      targetId: dto.targetId,
      ts: dto.ts ?? Date.now(),
    };
    const result = this.orchestrator.handle(event);
    return { status: 'accepted', deduped: result.deduped };
  }
}
