/**
 * Worker process (ADR-0025) — `node dist/worker.js` (dev: `npm run worker`). Separate
 * from the web server: it consumes the pg-boss queue and runs the slow Vertex meeting
 * processing out-of-band, reusing the `prisma` + `storage` singletons. Run alongside the
 * web process (two process types against the same Postgres).
 */
// Langfuse must be imported first — it starts the OTEL SDK before any code that could create
// spans is loaded (no-op when LANGFUSE_* keys are absent).
// eslint-disable-next-line import-x/no-duplicates -- side-effect import must stay first
import "./lib/langfuse.js";
import { registerCaptureWorker } from "./jobs/capture.worker.js";
import { registerMeetingWorker } from "./jobs/meeting.worker.js";
import { startQueue } from "./jobs/queue.js";
import { reconcileStuckJobs } from "./jobs/reconcile.js";
// eslint-disable-next-line import-x/no-duplicates -- see the bootstrap import above
import { shutdownLangfuse } from "./lib/langfuse.js";
import prisma from "./lib/prisma.js";

async function main(): Promise<void> {
  await prisma.$connect();
  const boss = await startQueue();
  await registerMeetingWorker(boss);
  await registerCaptureWorker(boss);
  // Clear rows orphaned in `processing` by a previous crash/redeploy (FE would poll them forever).
  await reconcileStuckJobs();
  console.log("Worker started — consuming meeting + capture AI jobs.");

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, stopping worker gracefully...`);

    boss
      .stop()
      .then(() => prisma.$disconnect())
      // Flush buffered Langfuse spans before exit.
      .then(() => shutdownLangfuse())
      .then(() => {
        console.log("Worker shutdown complete.");
        process.exit(0);
      })
      .catch((err: unknown) => {
        console.error("Error during worker shutdown:", err);
        process.exit(1);
      });

    setTimeout(() => {
      console.error("Forcing worker exit after 30s shutdown timeout.");
      process.exit(1);
    }, 30_000).unref();
  };

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    process.exit(1);
  });
}

main().catch(async (error: unknown) => {
  console.error("Failed to start worker:", error);
  await prisma.$disconnect();
  process.exit(1);
});
