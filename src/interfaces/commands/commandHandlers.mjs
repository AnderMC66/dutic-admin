import { join } from "node:path";

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
import { BRIDGE_DIR } from "../../infrastructure/paths.mjs";

const HELP_TEXT = [
  "🤖 *Comandos disponibles* (escríbelos en este chat):",
  "!brief — qué tengo pendiente (académico + WhatsApp)",
  "!sync — forzar sincronización DUTIC → wacon ahora",
  "!riesgo — riesgo de reprobar por curso",
  "!docentes <courseId> — docentes de un curso",
  "!digest <courseId> — resumen del grupo de WhatsApp del curso",
  "!companeros <courseId> — roster oficial vs. grupo de WhatsApp",
  "!estudio <courseId> <tema...> — consejo de estudio (NotebookLM)",
  "!material <courseId> — descargar todo el material del curso",
  "!examen [dias] — preparar material de exámenes próximos (default 3 días)",
  "!calendario — .ics con tus entregas, para el calendario del teléfono",
  "!cursos — tus cursos con su courseId (para los comandos que lo piden)",
  "!ayuda — este mensaje",
].join("\n");

function courseIdFrom(args) {
  const id = Number(args[0]);
  return Number.isInteger(id) ? id : null;
}

/**
 * "26A ECONOMÍA: ECONOMÍA POLÍTICA (E) GA" → "ECONOMÍA POLÍTICA (E) GA" — solo saca el prefijo
 * de semestre+carrera, que se repite en todos tus cursos y no aporta nada a la lista. Nada
 * más: recortar el resto es arriesgado (nombres/grupos varían de forma que un regex no cubre
 * bien), así que se deja tal cual viene de dutic.
 */
export function shortCourseLabel(courseName) {
  return courseName.replace(/^\S+\s+[A-ZÁÉÍÓÚÑ]+:\s*/, "");
}

/** Lista "courseId — nombre" — la reusan !cursos y el panel interactivo antes de pedir un courseId. */
export async function buildCourseList(deps) {
  const { courses } = await new ListCourses(deps).run();
  return courses.map((c) => ({ ...c, label: shortCourseLabel(c.courseName) }));
}

/** Cuerpo del brief, sin título — lo reusan !brief, el push diario automático y la CLI. */
export async function buildBriefText(deps) {
  const r = await new GetUnifiedBrief(deps).run();
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

/**
 * Traduce cada comando (WhatsApp o CLI) a un caso de uso ya existente — los
 * mismos que usa el servidor MCP, solo que acá la respuesta se formatea
 * como texto corto en vez de JSON para un agente. Interface-agnóstico: lo
 * usan tanto `interfaces/daemon/reminder-listener.mjs` (WhatsApp) como
 * `interfaces/cli/dutic-wacon.mjs` (terminal).
 */
export function buildCommandHandlers(deps) {
  return {
    async ayuda() {
      return HELP_TEXT;
    },
    async help() {
      return HELP_TEXT;
    },

    async brief() {
      return `📋 *Brief*\n\n${await buildBriefText(deps)}`;
    },

    async sync() {
      const r = await new SyncAcademicTasks(deps).run();
      return `🔄 Sync corrido: +${r.added.length} nuevas, ${r.dueChanged.length} con fecha cambiada, ${r.resolved.length} resueltas, ${r.conflicts.length} conflictos, ${r.silentOverdue.length} vencidas sin aviso.`;
    },

    async riesgo() {
      const r = await new AssessGradeRisk(deps).run();
      const concerning = r.assessments.filter((a) => a.status === "riesgo" || a.status === "atencion");
      if (!concerning.length) return "🎓 Ningún curso en riesgo por ahora (con los datos disponibles).";
      const lines = ["🎓 *Riesgo de notas*:"];
      for (const a of concerning) lines.push(`• ${a.courseName}: ${a.status} (~${a.referenceOn20 ?? "—"}/20)`);
      if (!r.sisacadAvailable) lines.push("\n(sin SISACAD capturado — corre 'dutic sisacad' para comparar con la fuente oficial)");
      return lines.join("\n");
    },

    async docentes(args) {
      const courseId = courseIdFrom(args);
      if (courseId == null) return "Uso: docentes <courseId>";
      const r = await new GetCourseTeachers(deps).run(courseId);
      return r.teachers.length ? `👨‍🏫 Docentes del curso ${courseId}:\n${r.teachers.map((t) => `• ${t}`).join("\n")}` : "No se pudo identificar docentes.";
    },

    async digest(args) {
      const courseId = courseIdFrom(args);
      if (courseId == null) return "Uso: digest <courseId>";
      const r = await new GetCourseDigest(deps).run(courseId);
      if (!r.mapped) return r.message;
      if (!r.activity.incoming) return `📭 Sin actividad nueva en el grupo del curso ${courseId}.`;
      return `📨 ${r.activity.incoming} mensaje(s) nuevos en "${r.activity.name}".\nÚltimo: "${r.activity.preview}"`;
    },

    async companeros(args) {
      const courseId = courseIdFrom(args);
      if (courseId == null) return "Uso: companeros <courseId>";
      const r = await new CrossReferenceClassmates(deps).run(courseId);
      if (!r.mapped) return r.message;
      return `👥 Curso ${courseId} vs. "${r.groupName}": ${r.matched.length} coinciden, ${r.onlyInRoster.length} solo en roster, ${r.onlyInGroup.length} solo en el grupo.`;
    },

    async estudio(args) {
      const courseId = courseIdFrom(args);
      const topic = args.slice(1).join(" ");
      if (courseId == null || !topic) return "Uso: estudio <courseId> <tema>";
      const r = await new GetStudyAdvice(deps).run(courseId, topic);
      if (!r.advised) return r.message;
      if (!r.consulted) return `📚 ${r.note ?? "No se pudo consultar el playbook para este curso."}`;
      return `📚 *Consejo de estudio*:\n${JSON.stringify(r.result ?? r, null, 2).slice(0, 3000)}`;
    },

    async material(args) {
      const courseId = courseIdFrom(args);
      if (courseId == null) return "Uso: material <courseId>";
      const r = await new PullAllCourseMaterials({ ...deps, destDir: join(BRIDGE_DIR, "materiales-completos") }).run(courseId);
      return `📥 Material del curso ${courseId} descargado en ${r.dest}.`;
    },

    async examen(args) {
      const daysBefore = args[0] ? Number(args[0]) : undefined;
      const r = await new PrefetchExamMaterials({ ...deps, daysBefore, destDir: join(BRIDGE_DIR, "materiales") }).run();
      return r.fetched.length
        ? `📖 Material preparado para ${r.fetched.length} examen(es) próximo(s).`
        : "📖 Ningún examen próximo dentro de la ventana pedida.";
    },

    async calendario() {
      // ExportCalendar ya manda el .ics por WhatsApp; esto es solo el ack del comando.
      const r = await new ExportCalendar({ ...deps, destPath: deps.calendarPath }).run();
      return `✅ Calendario mandado (${r.eventCount} evento(s)).`;
    },

    async cursos() {
      const courses = await buildCourseList(deps);
      const lines = ["🎓 *Tus cursos* (courseId — nombre):"];
      for (const c of courses) lines.push(`• ${c.courseId} — ${c.label}`);
      return lines.join("\n");
    },
  };
}
