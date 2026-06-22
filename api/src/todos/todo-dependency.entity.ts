import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// A dependency edge: `dependentId` depends on `dependencyId`
// (the dependency must be COMPLETED before the dependent can progress).
@Entity('todo_dependencies')
@Index(['dependentId', 'dependencyId'], { unique: true })
@Index(['dependencyId'])
export class TodoDependency {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  dependentId!: string;

  @Column('uuid')
  dependencyId!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
