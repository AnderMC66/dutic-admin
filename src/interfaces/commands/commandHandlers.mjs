import { GetUnifiedBrief } from "../../application/use-cases/GetUnifiedBrief.mjs";
import { ListCourses } from "../../application/use-cases/ListCourses.mjs";
import { COMMAND_REGISTRY, buildHelpText, formatBriefBody, parsePositionalArgs, shortCourseLabel } from "./registry.mjs";

export { shortCourseLabel };

const HELP_TEXT = buildHelpText({
  prefix: "!",
  header: "🤖 *Comandos disponibles* (escríbelos en este chat):",
  footer: "!ayuda — este mensaje",
});

/** Cuerpo del brief, sin título — lo reusan el comando `brief` y el push diario automático. */
export async function buildBriefText(deps) {
  return formatBriefBody(await new GetUnifiedBrief(deps).run());
}

/** Lista "courseId — nombre" — la reusan el comando `cursos` y el panel interactivo antes de pedir un courseId. */
export async function buildCourseList(deps) {
  const { courses } = await new ListCourses(deps).run();
  return courses.map((c) => ({ ...c, label: shortCourseLabel(c.courseName) }));
}

/**
 * Traduce cada comando (WhatsApp o CLI) a su caso de uso. Ahora es un envoltorio
 * fino sobre `registry.mjs`: acá sólo vive el camino "argumentos posicionales →
 * texto corto", que comparten el listener de WhatsApp y la CLI nativa. El
 * servidor MCP recorre el mismo registro pero se queda con el resultado crudo.
 */
export function buildCommandHandlers(deps) {
  const handlers = {
    async ayuda() {
      return HELP_TEXT;
    },
    async help() {
      return HELP_TEXT;
    },
  };

  for (const command of COMMAND_REGISTRY) {
    handlers[command.name] = async (args = []) => {
      const { input, error } = parsePositionalArgs(command, args);
      if (error) return error;
      const result = await command.execute(deps, input);
      return command.format(result, input);
    };
  }

  return handlers;
}
