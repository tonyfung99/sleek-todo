import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';
import { TodoPriority, TodoStatus } from '../todo.entity';

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
}
