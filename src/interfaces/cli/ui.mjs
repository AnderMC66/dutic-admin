// Helpers de color/layout para la CLI — sin dependencias, respeta NO_COLOR
// y detecta si hay una TTY real (mismo criterio que usa dutic-mcp).
const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR === "1");

function wrap(open, close = "0") {
  return (text) => (useColor ? `\x1b[${open}m${text}\x1b[${close}m` : String(text));
}

export const c = {
  bold: wrap("1"),
  dim: wrap("2"),
  cyan: wrap("36"),
  boldCyan: wrap("1;36"),
  yellow: wrap("33"),
  green: wrap("32"),
  gray: wrap("90"),
};

/** Ancho de terminal, acotado a un rango razonable (evita líneas absurdas en monitores ultra-anchos). */
export function termWidth(max = 84, min = 44) {
  const w = process.stdout.columns || 78;
  return Math.max(min, Math.min(w, max));
}

export function rule(width = termWidth()) {
  return c.dim("─".repeat(width));
}

/** Caja de título de ancho completo, tipo panel de comandos. */
export function headerBox(title, right = "", width = termWidth()) {
  const inner = width - 2;
  const leftPart = ` ${title}`;
  const rightPart = right ? `${right} ` : "";
  const gap = Math.max(1, inner - leftPart.length - rightPart.length);
  const line = leftPart + " ".repeat(gap) + rightPart;
  const top = "┌" + "─".repeat(inner) + "┐";
  const bot = "└" + "─".repeat(inner) + "┘";
  return [c.cyan(top), c.cyan("│") + c.boldCyan(line) + c.cyan("│"), c.cyan(bot)].join("\n");
}

export function clearScreen() {
  if (process.stdout.isTTY) console.clear();
}
