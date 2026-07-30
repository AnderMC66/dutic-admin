import { z } from "zod";

import { SyncAcademicTasks } from "../../application/use-cases/SyncAcademicTasks.mjs";
import { GetUnifiedBrief } from "../../application/use-cases/GetUnifiedBrief.mjs";
import { AssessGradeRisk } from "../../application/use-cases/AssessGradeRisk.mjs";
import { PrefetchExamMaterials } from "../../application/use-cases/PrefetchExamMaterials.mjs";
import { PullAllCourseMaterials } from "../../application/use-cases/PullAllCourseMaterials.mjs";
import { CrossReferenceClassmates } from "../../application/use-cases/CrossReferenceClassmates.mjs";
import { GetStudyAdvice } from "../../application/use-cases/GetStudyAdvice.mjs";
import { GetCourseDigest } from "../../application/use-cases/GetCourseDigest.mjs";
import { GetCourseTeachers } from "../../application/use-cases/GetCourseTeachers.mjs";
import { ExportCalendar } from "../../application/use-cases/ExportCalendar.mjs";
import { ListCourses } from "../../application/use-cases/ListCourses.mjs";

/**
 * Cada comando, definido UNA sola vez.
 *
 * Antes la misma lista vivía en cinco lugares —los handlers, COMMAND_SPECS del
 * menú, el HELP de duticbat, el HELP_TEXT de WhatsApp y los registerTool del
 * servidor MCP— así que agregar un comando eran cinco ediciones y cualquier
 * olvido quedaba como una inconsistencia silenciosa entre puertas de entrada.
 *
 * Contrato de cada entrada:
 *  - `args`: de acá salen los prompts del menú y el string de uso ("Uso: ..."),
 *    y la validación de los argumentos posicionales de CLI/WhatsApp.
 *  - `execute(deps, input)`: corre el caso de uso y devuelve su resultado crudo.
 *    Es lo que consume el servidor MCP, que quiere datos para un agente.
 *  - `format(result, input)`: convierte ese resultado en el texto corto que se
 *    manda por WhatsApp o se imprime en la terminal.
 *  - `mcp`: nombre/título/descripción y esquema zod del tool. `null` si el
 *    comando no tiene sentido para un agente (`ayuda`).
 */

/**
 * @typedef {object} CommandArg
 * @property {string} name Nombre del campo en el objeto de entrada (y en el esquema de MCP).
 * @property {string} prompt Lo que pregunta el panel interactivo.
 * @property {boolean} [optional]
 * @property {boolean} [rest] Se queda con todo lo que sobra de la línea (temas con espacios).
 * @property {(raw:string) => {value?:any, error?:string}} parse
 *
 * @typedef {object} Command
 * @property {string} name
 * @property {string} category Agrupa en el menú.
 * @property {string} label Una línea, la usan el menú y las dos ayudas.
 * @property {CommandArg[]} args
 * @property {(deps:any, input?:any) => Promise<any>} execute Corre el caso de uso, devuelve el resultado crudo.
 * @property {(result:any, input?:any) => string} format Vuelve ese resultado texto corto para WhatsApp/terminal.
 * @property {{name:string, title:string, description:string, inputSchema:object}|null} [mcp]
 */

/** Tipos de argumento posicional: cómo se piden y cómo se validan. */
const courseIdArg = {
  name: "courseId",
  prompt: "courseId: ",
  parse: (raw) => {
    const id = Number(raw);
    return Number.isInteger(id) ? { value: id } : { error: "courseId tiene que ser un número entero (usá 'cursos' para verlos)." };
  },
};

/** @type {Command[]} */
const COMMANDS = [
  {
    name: "brief",
    category: "Académico",
    label: "Qué tengo pendiente (académico + WhatsApp)",
    args: [],
    execute: (deps) => new GetUnifiedBrief(deps).run(),
    format: (r) => `📋 *Brief*\n\n${formatBriefBody(r)}`,
    mcp: {
      name: "bridge_get_unified_brief",
      title: "Brief académico unificado",
      description:
        "Foto en vivo de tu situación académica: tareas pendientes (con las ocultas), riesgo de reprobar por curso, " +
        "conflictos de fecha entre Moodle y los grupos de WhatsApp de curso, y tareas vencidas sin ningún aviso de " +
        "prórroga. Solo lectura — no modifica nada ni manda WhatsApp.",
      inputSchema: {},
    },
  },
  {
    name: "sync",
    category: "Académico",
    label: "Forzar sincronización DUTIC → wacon",
    args: [],
    execute: (deps) => new SyncAcademicTasks(deps).run(),
    format: (r) =>
      `🔄 Sync corrido: +${r.added.length} nuevas, ${r.dueChanged.length} con fecha cambiada, ${r.resolved.length} resueltas, ` +
      `${r.conflicts.length} conflictos, ${r.silentOverdue.length} vencidas sin aviso.` +
      (r.keptUnscanned?.length ? `\n⚠️ ${r.keptUnscanned.length} tarea(s) sin revisar: ${r.scanErrors.length} curso(s) no se pudieron barrer.` : ""),
    mcp: {
      name: "bridge_force_sync",
      title: "Forzar sincronización DUTIC → wacon",
      description:
        "Corre ya mismo (sin esperar el cron de 6h) la sincronización de tareas de DUTIC hacia la agenda de wacon: " +
        "crea/cierra/reprograma tareas, detecta conflictos de fecha y vencidas sin aviso, y manda un WhatsApp si hay novedades.",
      inputSchema: {},
    },
  },
  {
    name: "riesgo",
    category: "Académico",
    label: "Riesgo de reprobar por curso",
    args: [],
    execute: (deps) => new AssessGradeRisk(deps).run(),
    format: (r) => {
      const concerning = r.assessments.filter((a) => a.status === "riesgo" || a.status === "atencion");
      if (!concerning.length) return "🎓 Ningún curso en riesgo por ahora (con los datos disponibles).";
      const lines = ["🎓 *Riesgo de notas*:"];
      for (const a of concerning) lines.push(`• ${a.courseName}: ${a.status} (~${a.referenceOn20 ?? "—"}/20)`);
      if (!r.sisacadAvailable) lines.push("\n(sin SISACAD capturado — corre 'dutic sisacad' para comparar con la fuente oficial)");
      return lines.join("\n");
    },
    mcp: {
      name: "bridge_assess_grade_risk",
      title: "Evaluar riesgo de notas",
      description:
        "Evalúa qué cursos están en riesgo de reprobar o cerca del mínimo, usando el % que calcula Moodle y — si ya " +
        "corriste 'dutic sisacad' — comparándolo contra el promedio oficial de SISACAD. Manda WhatsApp solo si hay algo nuevo.",
      inputSchema: {},
    },
  },
  {
    name: "calendario",
    category: "Académico",
    label: "Exportar calendario .ics (te lo manda por WhatsApp)",
    args: [],
    execute: (deps) => new ExportCalendar({ ...deps, destPath: deps.calendarPath }).run(),
    // ExportCalendar ya manda el .ics por WhatsApp; esto es solo el ack del comando.
    format: (r) => `✅ Calendario mandado (${r.eventCount} evento(s)).`,
    mcp: {
      name: "bridge_export_calendar",
      title: "Exportar calendario .ics",
      description: "Genera un .ics con tus entregas pendientes y lo manda por WhatsApp, para importar al calendario del teléfono.",
      inputSchema: {},
    },
  },
  {
    name: "cursos",
    category: "Académico",
    label: "Tus cursos con su courseId",
    args: [],
    execute: (deps) => new ListCourses(deps).run(),
    format: (r) => {
      const lines = ["🎓 *Tus cursos* (courseId — nombre):"];
      for (const c of r.courses) lines.push(`• ${c.courseId} — ${shortCourseLabel(c.courseName)}`);
      return lines.join("\n");
    },
    mcp: {
      name: "bridge_list_courses",
      title: "Listar cursos matriculados",
      description: "Tus cursos con su courseId — útil antes de llamar cualquier tool que pida un courseId.",
      inputSchema: {},
    },
  },

  {
    name: "docentes",
    category: "Por curso",
    label: "Docentes de un curso",
    args: [courseIdArg],
    execute: (deps, { courseId }) => new GetCourseTeachers(deps).run(courseId),
    format: (r) =>
      r.teachers.length
        ? `👨‍🏫 Docentes del curso ${r.courseId}:\n${r.teachers.map((t) => `• ${t}`).join("\n")}`
        : "No se pudo identificar docentes.",
    mcp: {
      name: "bridge_get_course_teachers",
      title: "Docentes de un curso",
      description: "Lista los docentes de un curso (nombre, deducido de contactos y de quién califica en Moodle).",
      inputSchema: { courseId: z.number().int().describe("courseId de dutic.") },
    },
  },
  {
    name: "digest",
    category: "Por curso",
    label: "Resumen del grupo de WhatsApp del curso",
    args: [courseIdArg],
    execute: (deps, { courseId, sinceMinutes }) => new GetCourseDigest(deps).run(courseId, sinceMinutes),
    format: (r, { courseId }) => {
      if (!r.mapped) return r.message;
      if (!r.activity.incoming) return `📭 Sin actividad nueva en el grupo del curso ${courseId}.`;
      return `📨 ${r.activity.incoming} mensaje(s) nuevos en "${r.activity.name ?? r.chatJid}".\nÚltimo: "${r.activity.preview}"`;
    },
    mcp: {
      name: "bridge_get_course_digest",
      title: "Digest del grupo de un curso",
      description:
        "Resumen comprimido de la actividad reciente en el grupo de WhatsApp de un curso (cuántos mensajes, último " +
        "preview) sin leer el chat entero. Requiere el curso mapeado en course-groups.json.",
      inputSchema: {
        courseId: z.number().int().describe("courseId de dutic."),
        sinceMinutes: z.number().int().positive().default(1440).describe("Ventana hacia atrás, en minutos (default 24h)."),
      },
    },
  },
  {
    name: "companeros",
    category: "Por curso",
    label: "Roster oficial vs. grupo de WhatsApp",
    args: [courseIdArg],
    execute: (deps, { courseId }) => new CrossReferenceClassmates(deps).run(courseId),
    format: (r, { courseId }) =>
      r.mapped
        ? `👥 Curso ${courseId} vs. "${r.groupName}": ${r.matched.length} coinciden, ${r.onlyInRoster.length} solo en roster, ${r.onlyInGroup.length} solo en el grupo.`
        : r.message,
    mcp: {
      name: "bridge_cross_reference_classmates",
      title: "Cruzar compañeros de curso",
      description:
        "Compara el roster oficial de un curso (DUTIC) contra los miembros del grupo de WhatsApp de ese curso (wacon), " +
        "para saber quién del grupo es realmente tu compañero. Requiere haber mapeado el curso en " +
        "~/.dutic-wacon-bridge/course-groups.json.",
      inputSchema: { courseId: z.number().int().describe("courseId de dutic (ver dutic courses --json).") },
    },
  },
  {
    name: "estudio",
    category: "Por curso",
    label: "Consejo de estudio (NotebookLM)",
    args: [
      courseIdArg,
      {
        name: "tema",
        prompt: "Tema (ej. 'cómo resolver la práctica de integrales'): ",
        rest: true, // se queda con todo lo que sobra de la línea
        parse: (raw) => (raw ? { value: raw } : { error: "hace falta un tema." }),
      },
    ],
    execute: (deps, { courseId, tema }) => new GetStudyAdvice(deps).run(courseId, tema),
    format: (r) => {
      if (!r.advised) return r.message;
      if (!r.consulted) return `📚 ${r.note ?? "No se pudo consultar el playbook para este curso."}`;
      return `📚 *Consejo de estudio*:\n${JSON.stringify(r.result ?? r, null, 2).slice(0, 3000)}`;
    },
    mcp: {
      name: "bridge_get_study_advice",
      title: "Asesor de estudio (NotebookLM)",
      description:
        "Pide consejo de estudio para un curso citando material real: consulta el NotebookLM que tengas vinculado al " +
        "grupo de WhatsApp de ese curso (wacon consultPlaybook). Requiere: 1) el curso mapeado en course-groups.json, " +
        "2) el chat etiquetado con 'wacon tag', 3) el tag mapeado a un notebook en ~/.wacon/notebooks.json. Si falta " +
        "algo, degrada con una nota explicando qué, en vez de fallar.",
      inputSchema: {
        courseId: z.number().int().describe("courseId de dutic."),
        tema: z.string().describe("Sobre qué necesitas consejo, ej. 'cómo resolver la práctica de integrales'."),
      },
    },
  },
  {
    name: "material",
    category: "Por curso",
    label: "Descargar todo el material de un curso",
    args: [courseIdArg],
    execute: (deps, { courseId }) => new PullAllCourseMaterials({ ...deps, destDir: deps.allMaterialsDir }).run(courseId),
    format: (r, { courseId }) => `📥 Material del curso ${courseId} descargado en ${r.dest}.`,
    mcp: {
      name: "bridge_pull_all_materials",
      title: "Descargar todo el material de un curso",
      description:
        "Descarga TODOS los archivos de un curso (más amplio que bridge_prefetch_exam_materials, que solo mira " +
        "exámenes próximos) — útil al inicio de semestre o antes de un final que abarca todo el curso.",
      inputSchema: { courseId: z.number().int().describe("courseId de dutic.") },
    },
  },
  {
    name: "examen",
    category: "Por curso",
    label: "Preparar material de exámenes próximos",
    args: [
      {
        name: "dias",
        prompt: "Días de ventana (Enter = 3): ",
        optional: true,
        parse: (raw) => {
          const n = Number(raw);
          return Number.isInteger(n) && n > 0 ? { value: n } : { error: "los días tienen que ser un entero positivo." };
        },
      },
    ],
    execute: (deps, { dias }) => new PrefetchExamMaterials({ ...deps, daysBefore: dias, destDir: deps.examMaterialsDir }).run(),
    format: (r) =>
      r.fetched.length
        ? `📖 Material preparado para ${r.fetched.length} examen(es) próximo(s).`
        : "📖 Ningún examen próximo dentro de la ventana pedida.",
    mcp: {
      name: "bridge_prefetch_exam_materials",
      title: "Preparar material de examen",
      description: "Descarga y convierte a Markdown el material de los cursos con una tarea tipo examen próxima a vencer.",
      // El nombre del campo tiene que coincidir con el `args` de arriba, porque
      // `execute` recibe el mismo objeto de entrada desde las dos puertas.
      inputSchema: { dias: z.number().int().positive().default(3).describe("Ventana de días antes del examen.") },
    },
  },
];

/**
 * "26A ECONOMÍA: ECONOMÍA POLÍTICA (E) GA" → "ECONOMÍA POLÍTICA (E) GA" — solo saca el prefijo
 * de semestre+carrera, que se repite en todos tus cursos y no aporta nada a la lista. Nada
 * más: recortar el resto es arriesgado (nombres/grupos varían de forma que un regex no cubre
 * bien), así que se deja tal cual viene de dutic.
 */
export function shortCourseLabel(courseName) {
  return courseName.replace(/^\S+\s+[A-ZÁÉÍÓÚÑ]+:\s*/, "");
}

/** Cuerpo del brief, sin título — lo reusan el comando `brief` y el push diario automático. */
export function formatBriefBody(r) {
  const lines = [`📌 Pendientes, por prioridad de estudio (${r.pendingTasks.length}):`];
  for (const t of r.pendingTasks.slice(0, 10)) {
    const when = t.due ? ` — ${new Date(t.due).toLocaleDateString("es-PE")}` : "";
    const weight = t.weightPercent ? ` (${t.weightPercent}% de la nota)` : "";
    lines.push(`• ${t.course}: ${t.name}${when}${weight}`);
  }
  if (r.gradeRisks.length) {
    lines.push(`\n🎓 Notas a vigilar:`);
    for (const g of r.gradeRisks) lines.push(`• ${g.courseName}: ${g.status} (~${g.referenceOn20 ?? "—"}/20)`);
  }
  if (r.dateConflicts.length) lines.push(`\n⚠️ ${r.dateConflicts.length} conflicto(s) de fecha.`);
  if (r.silentOverdue.length) lines.push(`\n🚨 ${r.silentOverdue.length} vencida(s) sin aviso.`);
  if (r.social?.pendingReplies?.length) lines.push(`\n💬 ${r.social.pendingReplies.length} chat(s) sin responder.`);
  return lines.join("\n");
}

/** "estudio <courseId> <tema>" — se arma desde `args`, no se escribe a mano en cada handler. @param {Command} command */
export function usageOf(command) {
  const parts = command.args.map((a) => (a.optional ? `[${a.name}]` : `<${a.name}>`));
  return `Uso: ${command.name}${parts.length ? ` ${parts.join(" ")}` : ""}`;
}

/**
 * Convierte los argumentos posicionales de CLI/WhatsApp en el objeto de entrada
 * que espera `execute` — el mismo que le pasa el servidor MCP ya tipado por zod.
 * Devuelve siempre las dos claves (una en null) para que quien lo use no tenga
 * que adivinar la forma del resultado.
 * @param {Command} command @param {string[]} rawArgs
 * @returns {{input: object|null, error: string|null}}
 */
export function parsePositionalArgs(command, rawArgs) {
  const input = {};
  for (const [i, spec] of command.args.entries()) {
    const raw = spec.rest ? rawArgs.slice(i).join(" ") : rawArgs[i];
    if (raw == null || raw === "") {
      if (spec.optional) continue;
      return { input: null, error: usageOf(command) };
    }
    const parsed = spec.parse(raw);
    if (parsed.error) return { input: null, error: `${parsed.error}\n${usageOf(command)}` };
    input[spec.name] = parsed.value;
  }
  return { input, error: null };
}

export const COMMAND_REGISTRY = COMMANDS;

export function findCommand(name) {
  return COMMANDS.find((c) => c.name === name) ?? null;
}

/**
 * Texto de ayuda, derivado del registro: una sola fuente para WhatsApp y para la CLI.
 * @param {{prefix?:string, header?:string, footer?:string}} [opts]
 */
export function buildHelpText({ prefix = "", header, footer } = {}) {
  const lines = header ? [header] : [];
  for (const command of COMMANDS) {
    const args = command.args.map((a) => (a.optional ? `[${a.name}]` : `<${a.name}>`)).join(" ");
    lines.push(`${prefix}${command.name}${args ? ` ${args}` : ""} — ${command.label}`);
  }
  if (footer) lines.push(footer);
  return lines.join("\n");
}
