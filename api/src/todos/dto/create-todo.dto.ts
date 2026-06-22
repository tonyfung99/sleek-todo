import { IsEnum, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';
import { TodoPriority } from '../todo.entity';

export class CreateTodoDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsISO8601()
  dueDate?: string | null;

  @IsOptional()
  @IsEnum(TodoPriority)
  priority?: TodoPriority;
}
