import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { WACON_DAEMON_INFO_PATH } from "../paths.mjs";

/**
 * Transporte crudo hacia el daemon de wacon (RPC único, whitelisted).
 * Los adaptadores de dominio (WaconAgendaAdapter, WaconNotifier) se apoyan
 * en esta clase; nadie fuera de infrastructure/wacon sabe que existe.
 */
export class WaconDaemonClient {
  constructor(logger) {
    this.logger = logger;
    this.info = null;
    this._selfJid = undefined;
  }

  /**
   * `wacon` auto-spawna su propio daemon en cualquier comando CLI (ver
   * wacon-mcp daemon/lifecycle.ts ensureDaemon). Correr un comando barato acá
   * es la forma más simple de garantizar que el daemon esté vivo antes de
   * pegarle a su RPC directamente, sin duplicar esa lógica de spawn.
   */
  async ensureDaemon() {
    try {
      execFileSync("wacon", ["status"], { stdio: "ignore", shell: true, timeout: 20_000 });
    } catch (err) {
      throw new Error(`No se pudo levantar el daemon de wacon ('wacon status' falló): ${err.message}`);
    }
    if (!existsSync(WACON_DAEMON_INFO_PATH)) {
      throw new Error(`wacon no escribió ${WACON_DAEMON_INFO_PATH}. ¿Está instalado y logueado ('wacon login')?`);
    }
    this.info = JSON.parse(readFileSync(WACON_DAEMON_INFO_PATH, "utf8"));
    return this.info;
  }

  async rpc(method, args = []) {
    if (!this.info) await this.ensureDaemon();
    const res = await fetch(`http://127.0.0.1:${this.info.port}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.info.token}` },
      body: JSON.stringify({ method, args }),
    });
    const body = await res.json();
    if (!res.ok) {
      this.logger?.log(`RPC ${method} falló: ${body.error ?? res.statusText}`);
      throw new Error(`wacon RPC ${method}: ${body.error ?? res.statusText}`);
    }
    return body.result;
  }

  /** Cachea el JID propio (para mandarte WhatsApp a ti mismo) durante la corrida. */
  async getSelfJid() {
    if (this._selfJid !== undefined) return this._selfJid;
    const status = await this.rpc("status", []);
    this._selfJid = status.selfJid ?? null;
    return this._selfJid;
  }
}
