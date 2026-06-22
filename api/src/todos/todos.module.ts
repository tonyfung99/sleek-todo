import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ListsModule } from '../lists/lists.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { DependenciesService } from './dependencies.service';
import { Todo } from './todo.entity';
import { TodoDependency } from './todo-dependency.entity';
import { TodosController } from './todos.controller';
import { TodosService } from './todos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Todo, TodoDependency]),
    AuthModule,
    ListsModule,
    RealtimeModule,
  ],
  controllers: [TodosController],
  providers: [TodosService, DependenciesService],
  exports: [TodosService],
})
export class TodosModule {}
