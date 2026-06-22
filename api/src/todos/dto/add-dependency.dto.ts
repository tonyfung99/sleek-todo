import { IsUUID } from 'class-validator';

export class AddDependencyDto {
  @IsUUID()
  dependencyId!: string;
}
