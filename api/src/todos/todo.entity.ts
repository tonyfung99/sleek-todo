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
  ARCHIVED = 'ARCHIVED',
}

export enum TodoPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum RecurrenceUnit {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}

@Entity('todos')
@Index(['listId', 'deletedAt'])
@Index(['listId', 'status'])
@Index(['listId', 'dueDate'])
@Index(['listId', 'priority'])
export class Todo {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  listId!: string;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  dueDate!: Date | null;

  @Column({ type: 'enum', enum: TodoStatus, default: TodoStatus.NOT_STARTED })
  status!: TodoStatus;

  @Column({ type: 'enum', enum: TodoPriority, default: TodoPriority.MEDIUM })
  priority!: TodoPriority;

  @Column({ type: 'enum', enum: RecurrenceUnit, nullable: true })
  recurrenceUnit!: RecurrenceUnit | null;

  @Column({ type: 'int', nullable: true })
  recurrenceInterval!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

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
