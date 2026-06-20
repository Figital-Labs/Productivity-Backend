import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { registerCaptureWorker } from "./jobs/capture.worker.js";
import { registerMeetingWorker } from "./jobs/meeting.worker.js";
import { startQueue, stopQueue } from "./jobs/queue.js";
import prisma from "./lib/prisma.js";

async function main(): Promise<void> {
  // Verify DB connectivity on boot. Fail fast if Postgres is unreachable.
  await prisma.$connect();

  const app = createApp();
  // No host arg → binds all interfaces (0.0.0.0/::), required for Docker port publishing and
  // container health checks hitting the task IP. Logged as such so it doesn't read as loopback-only.
  const server = app.listen(env.port, () => {
    console.log(`Server listening on port ${env.port.toString()} (all interfaces)`);
  });

  // Single-process deploy: run the pg-boss consumer in-process (durable jobs + backpressure
  // without a second process to operate). Best-effort — if the queue can't start, the web
  // server still serves; meeting processing degrades and surfaces an error on enqueue.
  // Set RUN_WORKER_IN_PROCESS=false to split the worker out (run src/worker.ts).
  if (env.runWorkerInProcess) {
    startQueue()
      .then(async (boss) => {
        await registerMeetingWorker(boss);
        await registerCaptureWorker(boss);
      })
      .then(() => {
        console.log("Meeting + capture workers consuming jobs in-process.");
      })
      .catch((err: unknown) => {
        console.error("[queue] failed to start in-process worker:", err);
      });
  }

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);

    server.close((closeErr) => {
      if (closeErr) {
        console.error("Error closing HTTP server:", closeErr);
      }
      // Drain the in-process queue before disconnecting Prisma.
      stopQueue()
        .catch((qErr: unknown) => {
          console.error("Error stopping queue:", qErr);
        })
        .then(() => prisma.$disconnect())
        .then(() => {
          console.log("Shutdown complete.");
          process.exit(0);
        })
        .catch((dcErr: unknown) => {
          console.error("Error disconnecting Prisma:", dcErr);
          process.exit(1);
        });
    });

    // Force-exit if graceful shutdown stalls (e.g., hung long-lived connections).
    setTimeout(() => {
      console.error("Forcing exit after 30s shutdown timeout.");
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
  console.error("Failed to start server:", error);
  await prisma.$disconnect();
  process.exit(1);
});
