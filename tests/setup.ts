/**
 * Test env. `bun run test` doesn't pass .env to vitest, so it's loaded here (CI has none).
 * Database tests run only when TEST_DATABASE_URL is set (see .env.example); they point
 * DATABASE_URL at it so they never touch the dev database.
 */
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file
}

if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;

process.env.GITLAB_WEBHOOK_SECRET = "test-webhook-secret";
