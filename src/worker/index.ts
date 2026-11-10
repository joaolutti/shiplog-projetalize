/**
 * Background worker (Render "worker" service): `bun run worker`.
 * Runs pg-boss on the app database; registers one handler per queue in ./jobs.
 */
import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { handleIngestGitlabEvent, type IngestGitlabEventJob } from "./handlers/ingest-gitlab-event";
import { JOBS } from "./jobs";

async function main() {
  const boss = new PgBoss(env("DATABASE_URL"));
  boss.on("error", (err) => console.error("[worker] pg-boss error", err));
  await boss.start();

  for (const name of Object.values(JOBS)) {
    // Retries with backoff; GitLab and Slack hiccups shouldn't lose work.
    await boss.createQueue(name, { retryLimit: 5, retryBackoff: true, retryDelay: 10 });
  }

  await boss.work<IngestGitlabEventJob>(JOBS.ingestGitlabEvent, async (jobs) => {
    for (const job of jobs) await handleIngestGitlabEvent(job.data);
  });
  // TODO(M3): register the Slack DM, reminder and publish handlers.

  console.log(`[worker] started; queues: ${Object.values(JOBS).join(", ")}`);

  const stop = async () => {
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
