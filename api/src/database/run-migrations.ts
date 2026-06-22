import { AppDataSource } from './data-source';

// Standalone migration runner used by the API container at startup
// (compiled to dist/database/run-migrations.js). Reads DATABASE_URL from env.
async function run(): Promise<void> {
  await AppDataSource.initialize();
  const applied = await AppDataSource.runMigrations();
  // eslint-disable-next-line no-console
  console.log(`Applied ${applied.length} migration(s).`);
  await AppDataSource.destroy();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Migration failed:', err);
    process.exit(1);
  });
