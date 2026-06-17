/**
 * Worker process (ADR-0025) — `node dist/worker.js` (dev: `npm run worker`). Separate
 * from the web server: it consumes the pg-boss queue and runs the slow Vertex meeting
 * processing out-of-band, reusing the `prisma` + `storage` singletons. Run alongside the
 * web process (two process types against the same Postgres).
 */
import { registerMeetingWorker } from "./jobs/meeting.worker.js";
import { startQueue } from "./jobs/queue.js";
import prisma from "./lib/prisma.js";

async function main(): Promise<void> {
  await prisma.$connect();
  const boss = await startQueue();
  await registerMeetingWorker(boss);
  console.log("Worker started — consuming meeting AI jobs.");

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, stopping worker gracefully...`);

    boss
      .stop()
      .then(() => prisma.$disconnect())
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
