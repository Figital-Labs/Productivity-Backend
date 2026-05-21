import { createApp } from "./app.js";
import { env } from "./config/env.js";
import prisma from "./lib/prisma.js";

async function main(): Promise<void> {
  // Verify DB connectivity on boot. Fail fast if Postgres is unreachable.
  await prisma.$connect();

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`Server listening on http://localhost:${env.port.toString()}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);

    server.close((closeErr) => {
      if (closeErr) {
        console.error("Error closing HTTP server:", closeErr);
      }
      prisma
        .$disconnect()
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
