import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { WACON_DAEMON_INFO_PATH } from "../paths.mjs";

const execFileAsync = promisify(execFile);

// Generoso a propósito: no está acá para cortar llamadas lentas legítimas
// (`consultPlaybook` consulta NotebookLM) sino para que una llamada que NUNCA va
// a contestar no cuelgue al listener para siempre. El long-poll de
// waitForTriggers pasa el suyo (ver WaconTriggerAdapter).
const DEFAULT_RPC_TIMEOUT_MS = 120_000;

/**
 * Error de una llamada al daemon. `retryable` significa "la llamada NO llegó a
 * ejecutarse", que es lo único que habilita reintentarla: es una clase y no una
 * propiedad pegada a un Error suelto para que el contrato quede explícito.
 */
class WaconRpcError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = "WaconRpcError";
    this.retryable = retryable;
  }
}

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
      // Asíncrono: spawnear el daemon puede tardar segundos y esto corre también
      // dentro del listener siempre-vivo, que no puede quedarse sin event loop.
      await execFileAsync("wacon", ["status"], { shell: true, timeout: 20_000 });
    } catch (err) {
      throw new Error(`No se pudo levantar el daemon de wacon ('wacon status' falló): ${err.message}`);
    }
    if (!existsSync(WACON_DAEMON_INFO_PATH)) {
      throw new Error(`wacon no escribió ${WACON_DAEMON_INFO_PATH}. ¿Está instalado y logueado ('wacon login')?`);
    }
    try {
      this.info = JSON.parse(readFileSync(WACON_DAEMON_INFO_PATH, "utf8"));
    } catch (err) {
      throw new Error(`${WACON_DAEMON_INFO_PATH} no es JSON válido (${err.message}). Probá 'wacon status' a mano.`);
    }
    return this.info;
  }

  /**
   * Una llamada al daemon, con un reintento si —y solo si— la llamada no llegó
   * a ejecutarse: conexión rechazada (el daemon reinició y `daemon.json` tiene
   * un puerto nuevo) o token rechazado (token nuevo). Distinguir eso importa
   * porque `send` no es idempotente: reintentar a ciegas después de un timeout
   * podría mandarte el mismo WhatsApp dos veces.
   */
  async rpc(method, args = [], { timeoutMs = DEFAULT_RPC_TIMEOUT_MS } = {}) {
    if (!this.info) await this.ensureDaemon();

    try {
      return await this.attempt(method, args, timeoutMs);
    } catch (err) {
      if (!(err instanceof WaconRpcError) || !err.retryable) throw err;

      this.logger?.log(`RPC ${method}: el daemon parece haber reiniciado (${err.message}). Releyendo daemon.json y reintentando.`);
      this.info = null;
      this._selfJid = undefined;
      await this.ensureDaemon();
      return this.attempt(method, args, timeoutMs);
    }
  }

  /** Un solo intento. Marca en el error si vale la pena reintentarlo. */
  async attempt(method, args, timeoutMs) {
    let res;
    try {
      res = await fetch(`http://127.0.0.1:${this.info.port}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.info.token}` },
        body: JSON.stringify({ method, args }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      // fetch rechaza así tanto cuando nadie escucha en el puerto como cuando se
      // agotó el timeout, y hay que tratarlos distinto.
      const timedOut = cause.name === "TimeoutError" || cause.name === "AbortError";
      throw new WaconRpcError(
        timedOut
          ? `wacon RPC ${method}: el daemon no contestó en ${timeoutMs} ms`
          : `wacon RPC ${method}: no se pudo conectar al daemon (${cause.message})`,
        { retryable: !timedOut },
      );
    }

    // El daemon puede contestar algo que no es JSON (un 500 con HTML, un cuerpo
    // vacío): parsear a ciegas tapaba el error real con un error de parseo.
    const raw = await res.text();
    let body = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = { error: `respuesta no-JSON (HTTP ${res.status}): ${raw.slice(0, 200)}` };
      }
    }

    if (!res.ok) {
      this.logger?.log(`RPC ${method} falló: ${body.error ?? res.statusText}`);
      throw new WaconRpcError(`wacon RPC ${method}: ${body.error ?? res.statusText}`, {
        // Un token viejo: la llamada fue rechazada sin ejecutarse.
        retryable: res.status === 401 || res.status === 403,
      });
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
