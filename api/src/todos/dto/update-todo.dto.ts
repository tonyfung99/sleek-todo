import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { RecurrenceUnit, TodoPriority, TodoStatus } from '../todo.entity';

export class UpdateTodoDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsEnum(TodoStatus)
  status?: TodoStatus;

  @IsOptional()
  @IsEnum(TodoPriority)
  priority?: TodoPriority;

  @IsOptional()
  @IsISO8601()
  dueDate?: string | null;

  @IsOptional()
  @IsEnum(RecurrenceUnit)
  recurrenceUnit?: RecurrenceUnit | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  recurrenceInterval?: number | null;
}
