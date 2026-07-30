/**
 * Exclusión mutua entre corridas del MISMO caso de uso, a través de procesos
 * distintos. Hace falta porque las cuatro puertas de entrada (cron de 6h,
 * listener siempre-vivo, servidor MCP y CLI) son procesos separados que pueden
 * pedir el mismo trabajo a la vez — el cron disparando mientras escribís
 * "!sync" por WhatsApp. Fusionar el estado por clave no alcanza ahí: las dos
 * corridas son dueñas de la misma clave.
 */
export class RunLockPort {
  /**
   * Corre `fn` con exclusividad sobre `name`. Si ya hay otra corrida en curso,
   * lanza en vez de esperar (un sync puede tardar minutos).
   * @template T @param {string} name @param {() => Promise<T>} fn @returns {Promise<T>}
   */
  async withExclusiveRun(name, fn) {
    throw new Error("not implemented");
  }
}
