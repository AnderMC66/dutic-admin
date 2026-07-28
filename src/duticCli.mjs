import { execFileSync } from "node:child_process";

/**
 * Corre `dutic tasks --all --json`. Requiere sesión ya iniciada (`dutic login`,
 * hecho una vez por el usuario); si la sesión expiró, dutic intenta renovarla
 * sola con el perfil de Chrome guardado (ver README de dutic-mcp) — si eso
 * también falla, el comando revienta y dejamos que el caller lo reporte.
 */
export function getAllTasksFromDutic() {
  const raw = execFileSync("dutic", ["tasks", "--all", "--json"], {
    shell: true,
    timeout: 5 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
    encoding: "utf8",
  });
  const parsed = JSON.parse(raw);
  return parsed; // { tasks: Task[], scanErrors: [...] }
}
