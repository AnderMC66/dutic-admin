import { appendFileSync } from "node:fs";
import { LoggerPort } from "../../application/ports/LoggerPort.mjs";
import { ensureBridgeDir, LOG_PATH } from "../paths.mjs";

export class ConsoleFileLogger extends LoggerPort {
  log(line) {
    ensureBridgeDir();
    const stamped = `[${new Date().toISOString()}] ${line}`;
    console.log(stamped);
    appendFileSync(LOG_PATH, stamped + "\n");
  }
}
