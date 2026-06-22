import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateTodoDto } from './dto/create-todo.dto';
import { ListTodosQueryDto } from './dto/list-todos-query.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { Todo } from './todo.entity';
import { PaginatedTodos, TodosService } from './todos.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class TodosController {
  constructor(private readonly todos: TodosService) {}

  @Get('lists/:id/todos')
  list(
    @CurrentUser() user: AuthUser,
    @Param('id') listId: string,
    @Query() query: ListTodosQueryDto,
  ): Promise<PaginatedTodos> {
    return this.todos.listForList(listId, user.id, query);
  }

  @Post('lists/:id/todos')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') listId: string,
    @Body() dto: CreateTodoDto,
  ): Promise<Todo> {
    return this.todos.create(listId, user.id, dto);
  }

  @Patch('todos/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') todoId: string,
    @Headers('if-match') ifMatch: string,
    @Body() dto: UpdateTodoDto,
  ): Promise<Todo> {
    return this.todos.update(todoId, user.id, dto, Number.parseInt(ifMatch, 10));
  }

  @Delete('todos/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') todoId: string): Promise<void> {
    await this.todos.softDelete(todoId, user.id);
  }
}
