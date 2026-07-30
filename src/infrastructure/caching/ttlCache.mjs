/**
 * Memoiza una función asíncrona SIN argumentos por un rato corto.
 *
 * Está para los comandos que leen lo mismo dos veces en la misma corrida:
 * `!brief` pide tareas y notas a la vez, y si después escribís `!riesgo` se
 * vuelven a pedir las notas — y cada una de esas lecturas es un `dutic grades`
 * (timeout de 3 min) o un `dutic tasks` (5 min). Con un TTL corto se colapsan
 * esas ráfagas sin que el dato quede realmente viejo.
 *
 * Sólo para métodos sin parámetros: no hay clave por argumentos a propósito,
 * porque agregarla invitaría a cachear cosas por curso, donde el ahorro no
 * compensa el riesgo de servir algo viejo.
 */
export function memoizeAsync(fn, ttlMs) {
  let cached = null; // { at, value }
  let inFlight = null;

  return async () => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.value;

    // Dos llamadas simultáneas comparten la misma corrida: GetUnifiedBrief pide
    // tareas y notas en paralelo, y sin esto un Promise.all podría disparar dos
    // procesos del CLI a la vez.
    if (inFlight) return inFlight;

    inFlight = fn()
      .then((value) => {
        cached = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
