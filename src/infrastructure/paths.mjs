import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

export const BRIDGE_DIR = join(homedir(), ".dutic-wacon-bridge");
export const STATE_PATH = join(BRIDGE_DIR, "state.json");
export const STATE_LOCK_PATH = join(BRIDGE_DIR, "state.lock");
export const LOG_PATH = join(BRIDGE_DIR, "sync.log");
export const WACON_DAEMON_INFO_PATH = join(homedir(), ".wacon", "daemon.json");

export function ensureBridgeDir() {
  if (!existsSync(BRIDGE_DIR)) mkdirSync(BRIDGE_DIR, { recursive: true });
}
