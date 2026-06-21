import { TodoStatus } from '../todo.entity';

export class UpdateTodoDto {
  name?: string;
  description?: string | null;
  status?: TodoStatus;
}
