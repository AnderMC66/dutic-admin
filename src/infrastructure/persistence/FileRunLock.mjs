import { join } from "node:path";
import { RunLockPort } from "../../application/ports/RunLockPort.mjs";
import { withFileLock, LockBusyError } from "./fileLock.mjs";
import { ensureBridgeDir, BRIDGE_DIR } from "../paths.mjs";

// Una corrida completa puede tardar varios minutos (`dutic tasks` tiene timeout
// de 5, `dutic pull` de 10): el lock no puede darse por huérfano antes de eso.
const STALE_MS = 20 * 60_000;
// Corto a propósito: si ya hay una corrida en curso, mejor decirlo de una que
// dejar al usuario esperando minutos para recibir un resultado duplicado.
const TIMEOUT_MS = 2_000;

export class FileRunLock extends RunLockPort {
  async withExclusiveRun(name, fn) {
    ensureBridgeDir();
    try {
      return await withFileLock(join(BRIDGE_DIR, `${name}.run.lock`), fn, { timeoutMs: TIMEOUT_MS, staleMs: STALE_MS });
    } catch (err) {
      if (err instanceof LockBusyError) {
        throw new Error(`Ya hay una corrida de "${name}" en curso (otra puerta de entrada la está ejecutando). Probá de nuevo cuando termine.`);
      }
      throw err;
    }
  }
}
