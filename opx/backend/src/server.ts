// Entry point — load config, build the harness, boot the HTTP server.
//
// Run directly with Node's type stripping, no build step:
//   node --env-file=.env src/server.ts

import pino from "pino";
import { Harness, type Logger } from "./services/agent/harness.ts";
import { loadConfig } from "./config/index.ts";
import { createApp } from "./app.ts";

async function main(): Promise<void> {
  const config = loadConfig();

  const logger = pino({
    level: config.logLevel,
    transport:
      config.env === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  });

  const log: Logger = (level, msg, extra) => {
    if (extra && Object.keys(extra).length > 0) logger[level](extra, msg);
    else logger[level](msg);
  };

  const harness = new Harness(config, log);
  const boot = await harness.start();

  logger.info(
    {
      defaultModel: boot.defaultModel,
      models: boot.models.map((m) => `${m.id}${m.reachable ? "" : " (down)"}`),
      routing: boot.routingEnabled,
      memory: boot.memoryEnabled,
      protocol: boot.protocolMode,
      tools: boot.tools.length,
    },
    "workbench assembled",
  );

  const app = createApp({ harness, config, log });

  const server = app.listen(config.http.port, config.http.host, () => {
    logger.info(`OPX backend listening at http://${config.http.host}:${config.http.port}`);
    logger.info(`Default model: ${boot.defaultModel} — routing ${boot.routingEnabled ? "on" : "off"}`);
  });

  // Graceful shutdown on Ctrl+C / container stop: stop accepting connections,
  // release the egress fetch patch, then exit.
  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => {
      harness.stop();
      process.exit(0);
    });
    // Don't hang forever if a connection won't drain.
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
