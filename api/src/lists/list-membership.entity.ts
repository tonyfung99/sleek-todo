import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum MemberRole {
  OWNER = 'OWNER',
  EDITOR = 'EDITOR',
  VIEWER = 'VIEWER',
}

@Entity('list_memberships')
@Index(['listId', 'userId'], { unique: true })
export class ListMembership {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  listId!: string;

  @Column('uuid')
  userId!: string;

  @Column({ type: 'enum', enum: MemberRole })
  role!: MemberRole;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
