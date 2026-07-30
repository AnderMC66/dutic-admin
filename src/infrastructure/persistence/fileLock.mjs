import { mkdirSync, rmSync, statSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_STALE_MS = 60_000;
const RETRY_MS = 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Error de "el lock está tomado". Es una clase y no una propiedad pegada a un Error para que quien lo atrapa pueda distinguirlo. */
export class LockBusyError extends Error {
  constructor(message) {
    super(message);
    this.name = "LockBusyError";
    this.code = "ELOCKED";
  }
}

/** true si el lock lleva más de `staleMs` puesto (su dueño murió sin liberarlo). */
function isStale(lockDir, staleMs) {
  try {
    return Date.now() - statSync(lockDir).mtimeMs > staleMs;
  } catch {
    return false; // se liberó entre el mkdir y el stat: reintentar normal
  }
}

/**
 * Lock entre procesos basado en `mkdir` — la única primitiva atómica que
 * funciona igual en Windows y en POSIX sin dependencias. Hace falta porque las
 * cuatro puertas de entrada (cron de 6h, listener siempre-vivo, servidor MCP y
 * la CLI) son procesos distintos escribiendo el mismo state.json.
 *
 * Si el dueño del lock muere sin liberarlo (Task Scheduler matando al
 * listener), pasado `staleMs` se rompe solo — un lock eterno sería peor que la
 * carrera que evita.
 */
export async function withFileLock(lockDir, fn, { timeoutMs = DEFAULT_TIMEOUT_MS, staleMs = DEFAULT_STALE_MS } = {}) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      mkdirSync(lockDir); // falla con EEXIST si otro proceso lo tiene: eso es el lock
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      if (isStale(lockDir, staleMs)) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new LockBusyError(`No se pudo tomar el lock ${lockDir} en ${timeoutMs} ms (otro proceso lo tiene tomado).`);
      }
      await sleep(RETRY_MS);
    }
  }

  try {
    return await fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}
