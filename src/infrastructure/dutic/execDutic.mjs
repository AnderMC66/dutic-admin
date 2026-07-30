import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Lo que cmd.exe interpreta y por eso hay que citar. */
const NEEDS_QUOTING = /[\s&|<>^]/;

/**
 * true si el texto trae caracteres de control. A propósito NO es un regex con
 * un rango: escribir ese rango obliga a poner los caracteres literales en el
 * código, que son invisibles en el editor, se pierden en cualquier
 * normalización del archivo y hasta hacen que git trate el archivo como
 * binario. Un chequeo por code point dice lo mismo y se lee.
 */
function hasControlChars(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * `execFile` con `shell:true` (necesario en Windows para resolver el shim
 * `dutic.cmd` del PATH) NO escapa los argumentos — los concatena tal cual antes
 * de pasárselos a cmd.exe. Un argumento con espacios (un nombre de archivo
 * real, "Tarea elaboración del TIF.pdf") se corta en el primer espacio si no se
 * cita a mano. Este helper lo hace una sola vez para todos los adaptadores que
 * llaman al CLI de dutic.
 *
 * Las comillas se RECHAZAN en vez de escaparse: el escapado que había (`\"`) es
 * sintaxis de shells POSIX y cmd.exe no lo interpreta así, con lo cual una
 * comilla dentro del argumento cerraba la nuestra y el resto del texto pasaba a
 * ser línea de comandos. No hay forma confiable de expresar ese escapado en
 * cmd.exe, y ningún argumento legítimo de este bridge —un courseId, una URL
 * http(s), un path que armamos nosotros— las necesita, así que rechazar es más
 * seguro que adivinar. Los nombres que vienen de Moodle ya llegan saneados
 * (domain/services/SafeFileName.mjs); esto es la segunda línea de defensa.
 */
function quoteForCmd(arg) {
  const str = String(arg);
  if (str.includes('"') || hasControlChars(str)) {
    throw new Error(`Argumento rechazado por contener comillas o caracteres de control: ${JSON.stringify(str)}`);
  }
  return NEEDS_QUOTING.test(str) ? `"${str}"` : str;
}

/**
 * Asíncrono a propósito: la versión síncrona (`execFileSync`) bloqueaba el
 * event loop del proceso llamador durante toda la corrida del CLI. Con
 * timeouts de hasta 10 minutos (`dutic pull`), eso congelaba por completo al
 * listener siempre-vivo —sin recordatorios, sin comandos y con el cursor del
 * long-poll de wacon parado— y dejaba al servidor MCP sin atender su
 * transporte stdio, que el cliente ve como un servidor muerto.
 */
export async function execDutic(args, options = {}) {
  const { stdout } = await execFileAsync("dutic", args.map(quoteForCmd), { shell: true, encoding: "utf8", ...options });
  return stdout;
}
