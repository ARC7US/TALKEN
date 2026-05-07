import { buildApp } from "./app.js";
import { config } from "./config.js";
import { checkTimedOutVerifications } from "./services/verification-service.js";

const TIMEOUT_CHECK_INTERVAL_MS = 30_000; // 30 seconds

async function main() {
  const app = await buildApp();

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    console.log(`Task Market server running at http://${config.HOST}:${config.PORT}`);
    console.log(`WebSocket available at ws://${config.HOST}:${config.PORT}/ws`);
    console.log(`Stellar mode: ${config.STELLAR_MODE}`);

    // Periodic check for timed-out verification sessions
    setInterval(() => {
      try {
        const cancelled = checkTimedOutVerifications();
        if (cancelled.length > 0) {
          console.log(`[timeout] Auto-cancelled ${cancelled.length} task(s): ${cancelled.join(", ")}`);
        }
      } catch (err) {
        app.log.error(err, "[timeout] Error checking timed-out verifications");
      }
    }, TIMEOUT_CHECK_INTERVAL_MS);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
