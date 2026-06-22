import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1782091663055 implements MigrationInterface {
    name = 'InitialSchema1782091663055'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."list_memberships_role_enum" AS ENUM('OWNER', 'EDITOR', 'VIEWER')`);
        await queryRunner.query(`CREATE TABLE "list_memberships" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "listId" uuid NOT NULL, "userId" uuid NOT NULL, "role" "public"."list_memberships_role_enum" NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ef24c00353ac49c3f291a08aae9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_eb5a38cea2c6a6ff895c4ae044" ON "list_memberships"  ("listId", "userId") `);
        await queryRunner.query(`CREATE TYPE "public"."todos_status_enum" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')`);
        await queryRunner.query(`CREATE TABLE "todos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "listId" uuid NOT NULL, "name" character varying NOT NULL, "description" text, "status" "public"."todos_status_enum" NOT NULL DEFAULT 'NOT_STARTED', "version" integer NOT NULL DEFAULT '1', "createdById" uuid NOT NULL, "deletedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ca8cafd59ca6faaf67995344225" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b2bb004c80af94f39b98101802" ON "todos"  ("listId", "deletedAt") `);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "passwordHash" character varying NOT NULL, "displayName" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "todo_lists" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "ownerId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_abf14b565d762fb594a74fe6d71" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "todo_lists"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b2bb004c80af94f39b98101802"`);
        await queryRunner.query(`DROP TABLE "todos"`);
        await queryRunner.query(`DROP TYPE "public"."todos_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_eb5a38cea2c6a6ff895c4ae044"`);
        await queryRunner.query(`DROP TABLE "list_memberships"`);
        await queryRunner.query(`DROP TYPE "public"."list_memberships_role_enum"`);
    }

}
