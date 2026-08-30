import pino from "pino";
import { Harness, type Logger } from "./agent/harness.ts";
import { loadConfig } from "./config.ts";
import { createServer } from "./http/server.ts";

async function main() {
  const config = loadConfig();





  //Creating log
  const logger = pino({
    level: config.logLevel,
    transport:
      config.env === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  });

  const log: Logger = (level, msg, extra) => {
    if (extra && Object.keys(extra).length > 0) {
      logger[level](extra, msg);
    } else {
      logger[level](msg);
    }
  };





  //Creates the empty agent instance.
  const harness = new Harness(config, log);
  // Connects to the LLM,
  await harness.start();

  const app = createServer({ harness, config, log });

  app.listen(config.http.port, config.http.host, () => {
    logger.info(`ABHEDAY backend running at http://${config.http.host}:${config.http.port}`);
    logger.info(`Model: ${config.model.modelId} @ ${config.model.baseUrl}`);
  });


//Shutdown when press ctrl+c
  //SIGINT --> signal intrupt 
  process.on("SIGINT", () => {
    harness.stop();
    process.exit(0);
  });
}


//Calling the main function if promise is reject catch
main().catch((err: unknown) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
