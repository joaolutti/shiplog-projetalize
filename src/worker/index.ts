/**
 * Background worker (Render "worker" service): `npm run worker`.
 * Runs pg-boss on the app database; registers one handler per queue in ./jobs.
 */
import { PgBoss } from "pg-boss";
import { JOBS } from "./jobs";

async function main() {
  const boss = new PgBoss(process.env.DATABASE_URL!);
  boss.on("error", (err) => console.error("[worker] pg-boss error", err));
  await boss.start();

  for (const name of Object.values(JOBS)) {
    await boss.createQueue(name);
    // TODO(M1/M3): register real handlers, e.g. boss.work(JOBS.ingestGitlabEvent, handler)
  }

  console.log(`[worker] started; queues: ${Object.values(JOBS).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
