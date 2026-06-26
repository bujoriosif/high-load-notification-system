import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { SimStrategy } from './sim.types';

export class StartRunDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  total: number;

  @IsIn(['write', 'realtime', 'both'])
  strategy: SimStrategy;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(120_000)
  windowMs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  ratePerSec?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  writeCap?: number;
}
