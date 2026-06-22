import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateListDto } from './dto/create-list.dto';
import { ListMembership } from './list-membership.entity';
import { ListsService } from './lists.service';
import { TodoList } from './todo-list.entity';

@Controller('lists')
@UseGuards(JwtAuthGuard)
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateListDto): Promise<TodoList> {
    return this.lists.create(user.id, dto.name);
  }

  @Get()
  findMine(@CurrentUser() user: AuthUser): Promise<TodoList[]> {
    return this.lists.findForUser(user.id);
  }

  @Post(':id/members')
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('id') listId: string,
    @Body() dto: AddMemberDto,
  ): Promise<ListMembership> {
    return this.lists.addMember(listId, user.id, dto.email, dto.role);
  }
}
