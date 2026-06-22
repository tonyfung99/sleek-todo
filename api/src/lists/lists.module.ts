import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/user.entity';
import { ListMembership } from './list-membership.entity';
import { ListsController } from './lists.controller';
import { ListsService } from './lists.service';
import { TodoList } from './todo-list.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TodoList, ListMembership, User]), AuthModule],
  controllers: [ListsController],
  providers: [ListsService],
  exports: [ListsService],
})
export class ListsModule {}
