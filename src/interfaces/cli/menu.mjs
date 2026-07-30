import { createInterface } from "node:readline/promises";
import { c, rule, headerBox, clearScreen, termWidth } from "./ui.mjs";
import { buildCourseList } from "../commands/commandHandlers.mjs";
import { COMMAND_REGISTRY } from "../commands/registry.mjs";

// El menú se arma desde el registro de comandos: su categoría, su etiqueta y los
// prompts de sus argumentos ya están definidos ahí, así que un comando nuevo
// aparece acá solo. Antes esta lista era una cuarta copia que había que mantener
// en sincronía a mano.


function renderMenu() {
  const width = termWidth();
  const now = new Date().toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
  const lines = [headerBox("📚  DUTIC ⇄ WACON — panel de comandos", now, width), ""];

  let lastCategory = null;
  COMMAND_REGISTRY.forEach((spec, i) => {
    if (spec.category !== lastCategory) {
      if (lastCategory !== null) lines.push("");
      lines.push(`  ${c.bold(spec.category.toUpperCase())}`);
      lastCategory = spec.category;
    }
    const num = String(i + 1).padStart(3);
    lines.push(`  ${c.cyan(num)}  ${c.bold(spec.name.padEnd(12))} ${c.dim(spec.label)}`);
  });

  lines.push("");
  lines.push(`  ${c.cyan("  0")}  ${c.bold("salir".padEnd(12))} ${c.dim("Cerrar el panel")}`);
  lines.push("");
  lines.push(rule(width));
  return lines.join("\n");
}

/** Muestra "courseId — nombre" antes de pedir un courseId, para no tener que memorizarlos. Cachea entre preguntas. */
async function printCourseListForPrompt(argSpec, cache, deps) {
  if (argSpec.name !== "courseId") return cache;
  let courses = cache;
  if (!courses) {
    console.log(c.dim("(buscando tus cursos...)"));
    courses = await buildCourseList(deps).catch((err) => {
      console.log(c.yellow(`No se pudo traer la lista de cursos: ${err.message}`));
      return [];
    });
  }
  if (courses.length) {
    console.log(`\n${c.bold("Tus cursos:")}`);
    for (const course of courses) console.log(`  ${c.cyan(String(course.courseId).padStart(5))}  ${c.dim(course.label)}`);
    console.log();
  }
  return courses;
}

function resolveChoice(input) {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const byIndex = COMMAND_REGISTRY[Number(trimmed) - 1];
  if (byIndex) return byIndex;
  return COMMAND_REGISTRY.find((cmd) => cmd.name === trimmed) ?? null;
}

/**
 * Menú interactivo: para cuando no te acordás el nombre exacto de un
 * comando o sus argumentos — te los pregunta uno por uno. Corre en loop
 * hasta que elegís salir; cada comando reusa el mismo handler que la CLI
 * directa, WhatsApp y el servidor MCP (../commands/commandHandlers.mjs).
 */
export async function runMenu(handlers, deps) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let courseListCache = null;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      clearScreen();
      console.log(renderMenu());
      const raw = await rl.question(`${c.green("›")} Elegí un comando (número o nombre, 0 para salir): `);
      const choice = raw.trim().toLowerCase();
      if (choice === "0" || choice === "salir" || choice === "q" || choice === "exit") break;

      const spec = resolveChoice(raw);
      if (!spec) {
        console.log(c.yellow("\n⚠️  No reconozco esa opción."));
        await rl.question(c.dim("(Enter para volver) "));
        continue;
      }

      const args = [];
      let cancelled = false;
      for (const argSpec of spec.args) {
        courseListCache = await printCourseListForPrompt(argSpec, courseListCache, deps);
        const value = (await rl.question(c.dim(argSpec.prompt))).trim();
        if (!value) {
          if (argSpec.optional) continue;
          console.log(c.yellow("Ese dato es obligatorio — comando cancelado."));
          cancelled = true;
          break;
        }
        args.push(value);
      }
      if (cancelled) {
        await rl.question(c.dim("(Enter para volver) "));
        continue;
      }

      console.log(`\n${c.cyan("⏳")} Corriendo ${c.bold(spec.name)}...\n`);
      try {
        console.log(await handlers[spec.name](args));
      } catch (err) {
        console.error(c.yellow(`Error: ${err.message}`));
      }
      await rl.question(`\n${c.dim("(Enter para volver al menú)")} `);
    }
  } finally {
    rl.close();
  }
}
