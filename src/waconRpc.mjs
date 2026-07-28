import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { WACON_DAEMON_INFO_PATH } from "./paths.mjs";
import { log } from "./log.mjs";

/**
 * `wacon` auto-spawns its own daemon on any CLI command (see wacon-mcp
 * daemon/lifecycle.ts ensureDaemon). Running a cheap command here is the
 * simplest way to guarantee the daemon is alive before we hit its RPC
 * endpoint directly, without duplicating that spawn logic.
 */
export function ensureWaconDaemon() {
  try {
    execFileSync("wacon", ["status"], { stdio: "ignore", shell: true, timeout: 20_000 });
  } catch (err) {
    throw new Error(`No se pudo levantar el daemon de wacon ('wacon status' falló): ${err.message}`);
  }
  if (!existsSync(WACON_DAEMON_INFO_PATH)) {
    throw new Error(`wacon no escribió ${WACON_DAEMON_INFO_PATH}. ¿Está instalado y logueado ('wacon login')?`);
  }
  return JSON.parse(readFileSync(WACON_DAEMON_INFO_PATH, "utf8"));
}

/** Llama a un método del WaconApi vía el RPC único del daemon (whitelisted). */
export async function waconRpc(daemonInfo, method, args = []) {
  const res = await fetch(`http://127.0.0.1:${daemonInfo.port}/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${daemonInfo.token}`,
    },
    body: JSON.stringify({ method, args }),
  });
  const body = await res.json();
  if (!res.ok) {
    log(`RPC ${method} falló: ${body.error ?? res.statusText}`);
    throw new Error(`wacon RPC ${method}: ${body.error ?? res.statusText}`);
  }
  return body.result;
}
