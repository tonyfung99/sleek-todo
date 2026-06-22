import { MigrationInterface, QueryRunner } from "typeorm";

export class CoreFeatures1782099397924 implements MigrationInterface {
    name = 'CoreFeatures1782099397924'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "todo_dependencies" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "dependentId" uuid NOT NULL, "dependencyId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5bb8d110ce8c84a6f2505b05c1e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2c430b38a2348c42813b7fae88" ON "todo_dependencies"  ("dependencyId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_3e26ebd03f3225c6fb09d14156" ON "todo_dependencies"  ("dependentId", "dependencyId") `);
        await queryRunner.query(`ALTER TABLE "todos" ADD "dueDate" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`CREATE TYPE "public"."todos_priority_enum" AS ENUM('LOW', 'MEDIUM', 'HIGH')`);
        await queryRunner.query(`ALTER TABLE "todos" ADD "priority" "public"."todos_priority_enum" NOT NULL DEFAULT 'MEDIUM'`);
        await queryRunner.query(`CREATE TYPE "public"."todos_recurrenceunit_enum" AS ENUM('DAY', 'WEEK', 'MONTH')`);
        await queryRunner.query(`ALTER TABLE "todos" ADD "recurrenceUnit" "public"."todos_recurrenceunit_enum"`);
        await queryRunner.query(`ALTER TABLE "todos" ADD "recurrenceInterval" integer`);
        await queryRunner.query(`ALTER TABLE "todos" ADD "completedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TYPE "public"."todos_status_enum" ADD VALUE 'ARCHIVED'`);
        await queryRunner.query(`CREATE INDEX "IDX_67f01392f8dc18df969145a131" ON "todos"  ("listId", "priority") `);
        await queryRunner.query(`CREATE INDEX "IDX_2a900f96cc991ef1dab78aef52" ON "todos"  ("listId", "dueDate") `);
        await queryRunner.query(`CREATE INDEX "IDX_4bb66ababf62014da0abe8270c" ON "todos"  ("listId", "status") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_4bb66ababf62014da0abe8270c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2a900f96cc991ef1dab78aef52"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_67f01392f8dc18df969145a131"`);
        await queryRunner.query(`CREATE TYPE "public"."todos_status_enum_old" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')`);
        await queryRunner.query(`ALTER TABLE "todos" ALTER COLUMN "status" TYPE "public"."todos_status_enum_old" USING "status"::"text"::"public"."todos_status_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."todos_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."todos_status_enum_old" RENAME TO "todos_status_enum"`);
        await queryRunner.query(`ALTER TABLE "todos" DROP COLUMN "completedAt"`);
        await queryRunner.query(`ALTER TABLE "todos" DROP COLUMN "recurrenceInterval"`);
        await queryRunner.query(`ALTER TABLE "todos" DROP COLUMN "recurrenceUnit"`);
        await queryRunner.query(`DROP TYPE "public"."todos_recurrenceunit_enum"`);
        await queryRunner.query(`ALTER TABLE "todos" DROP COLUMN "priority"`);
        await queryRunner.query(`DROP TYPE "public"."todos_priority_enum"`);
        await queryRunner.query(`ALTER TABLE "todos" DROP COLUMN "dueDate"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3e26ebd03f3225c6fb09d14156"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2c430b38a2348c42813b7fae88"`);
        await queryRunner.query(`DROP TABLE "todo_dependencies"`);
    }

}
