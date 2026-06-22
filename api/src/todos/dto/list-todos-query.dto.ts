import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { TodoPriority, TodoStatus } from '../todo.entity';

export type SortField = 'dueDate' | 'priority' | 'status' | 'name' | 'createdAt';
export type SortDir = 'asc' | 'desc';

export class ListTodosQueryDto {
  @IsOptional()
  @IsEnum(TodoStatus)
  status?: TodoStatus;

  @IsOptional()
  @IsEnum(TodoPriority)
  priority?: TodoPriority;

  @IsOptional()
  @IsISO8601()
  dueBefore?: string;

  @IsOptional()
  @IsISO8601()
  dueAfter?: string;

  @IsOptional()
  @IsIn(['dueDate', 'priority', 'status', 'name', 'createdAt'])
  sort?: SortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: SortDir;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}
