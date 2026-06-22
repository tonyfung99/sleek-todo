import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TodoStatus } from '../todo.entity';

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
}
