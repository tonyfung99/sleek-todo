import { MemberRole } from '../list-membership.entity';

export class AddMemberDto {
  email!: string;
  role!: MemberRole;
}
