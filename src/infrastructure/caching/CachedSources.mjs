import { AcademicTaskSourcePort } from "../../application/ports/AcademicTaskSourcePort.mjs";
import { GradesSourcePort } from "../../application/ports/GradesSourcePort.mjs";
import { memoizeAsync } from "./ttlCache.mjs";

/**
 * 60 segundos: alcanza para colapsar la ráfaga de un comando (o de dos comandos
 * seguidos) y es lo bastante corto para que un sync nunca actúe sobre datos que
 * el usuario percibiría como viejos.
 */
export const DEFAULT_SOURCE_TTL_MS = 60_000;

/**
 * Decoradores de puerto: los casos de uso no saben que hay un caché, y el
 * adaptador real tampoco. Es exactamente el tipo de detalle que la arquitectura
 * deja meter sin tocar ni el dominio ni la aplicación.
 */
export class CachedAcademicTaskSource extends AcademicTaskSourcePort {
  constructor(inner, ttlMs = DEFAULT_SOURCE_TTL_MS) {
    super();
    this.read = memoizeAsync(() => inner.listAllTasks(), ttlMs);
  }

  async listAllTasks() {
    return this.read();
  }
}

export class CachedGradesSource extends GradesSourcePort {
  constructor(inner, ttlMs = DEFAULT_SOURCE_TTL_MS) {
    super();
    this.read = memoizeAsync(() => inner.listAllCourseGrades(), ttlMs);
  }

  async listAllCourseGrades() {
    return this.read();
  }
}
