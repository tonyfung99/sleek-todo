import { IsEmail, IsEnum } from 'class-validator';
import { MemberRole } from '../list-membership.entity';

export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsEnum(MemberRole)
  role!: MemberRole;
}
