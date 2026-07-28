import { appendFileSync } from "node:fs";
import { ensureBridgeDir, LOG_PATH } from "./paths.mjs";

export function log(line) {
  ensureBridgeDir();
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  appendFileSync(LOG_PATH, stamped + "\n");
}
