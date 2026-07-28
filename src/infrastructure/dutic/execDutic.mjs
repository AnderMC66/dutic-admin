import { execFileSync } from "node:child_process";

/**
 * `execFileSync` con `shell:true` (necesario en Windows para resolver el
 * shim `dutic.cmd` del PATH) NO escapa los argumentos — los concatena tal
 * cual antes de pasárselos a cmd.exe. Un argumento con espacios (un nombre
 * de archivo real, "Tarea elaboración del TIF.pdf") se corta en el primer
 * espacio si no se cita a mano. Este helper lo hace una sola vez para
 * todos los adaptadores que llaman al CLI de dutic.
 */
function quoteForCmd(arg) {
  const str = String(arg);
  return /[\s"&|<>^]/.test(str) ? `"${str.replace(/"/g, '\\"')}"` : str;
}

export function execDutic(args, options = {}) {
  return execFileSync("dutic", args.map(quoteForCmd), { shell: true, encoding: "utf8", ...options });
}
