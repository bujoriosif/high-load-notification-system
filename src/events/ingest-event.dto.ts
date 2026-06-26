import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { EventType } from '../common/types';

export class IngestEventDto {
  @IsString()
  eventId: string;

  @IsIn(['post_created', 'liked', 'replied', 'followed'])
  type: EventType;

  @IsString()
  actorId: string;

  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsString()
  targetId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  ts?: number;
}
