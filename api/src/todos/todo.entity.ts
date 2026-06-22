import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TodoStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

@Entity('todos')
@Index(['listId', 'deletedAt'])
export class Todo {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  listId!: string;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'enum', enum: TodoStatus, default: TodoStatus.NOT_STARTED })
  status!: TodoStatus;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column('uuid')
  createdById!: string;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
