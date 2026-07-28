#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join } from "node:path";

import { buildCompositionRoot } from "../../infrastructure/compositionRoot.mjs";
import { BRIDGE_DIR } from "../../infrastructure/paths.mjs";

import { SyncAcademicTasks } from "../../application/use-cases/SyncAcademicTasks.mjs";
import { GetUnifiedBrief } from "../../application/use-cases/GetUnifiedBrief.mjs";
import { AssessGradeRisk } from "../../application/use-cases/AssessGradeRisk.mjs";
import { PrefetchExamMaterials } from "../../application/use-cases/PrefetchExamMaterials.mjs";
import { CrossReferenceClassmates } from "../../application/use-cases/CrossReferenceClassmates.mjs";
import { GetStudyAdvice } from "../../application/use-cases/GetStudyAdvice.mjs";
import { GetCourseDigest } from "../../application/use-cases/GetCourseDigest.mjs";
import { GetCourseTeachers } from "../../application/use-cases/GetCourseTeachers.mjs";
import { PullAllCourseMaterials } from "../../application/use-cases/PullAllCourseMaterials.mjs";
import { ExportCalendar } from "../../application/use-cases/ExportCalendar.mjs";
import { ListCourses } from "../../application/use-cases/ListCourses.mjs";

async function tool(fn) {
  try {
    const data = await fn();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Error: ${err.message}` }] };
  }
}

async function main() {
  const deps = await buildCompositionRoot();
  const server = new McpServer({ name: "dutic-wacon-bridge", version: "0.1.0" });

  server.registerTool(
    "bridge_get_unified_brief",
    {
      title: "Brief académico unificado",
      description:
        "Foto en vivo de tu situación académica: tareas pendientes (con las ocultas), riesgo de reprobar por curso, " +
        "conflictos de fecha entre Moodle y los grupos de WhatsApp de curso, y tareas vencidas sin ningún aviso de " +
        "prórroga. Solo lectura — no modifica nada ni manda WhatsApp.",
      inputSchema: {},
    },
    async () => tool(() => new GetUnifiedBrief(deps).run()),
  );

  server.registerTool(
    "bridge_force_sync",
    {
      title: "Forzar sincronización DUTIC → wacon",
      description:
        "Corre ya mismo (sin esperar el cron de 6h) la sincronización de tareas de DUTIC hacia la agenda de wacon: " +
        "crea/cierra/reprograma tareas, detecta conflictos de fecha y vencidas sin aviso, y manda un WhatsApp si hay novedades.",
      inputSchema: {},
    },
    async () => tool(() => new SyncAcademicTasks(deps).run()),
  );

  server.registerTool(
    "bridge_assess_grade_risk",
    {
      title: "Evaluar riesgo de notas",
      description:
        "Evalúa qué cursos están en riesgo de reprobar o cerca del mínimo, usando el % que calcula Moodle y — si ya " +
        "corriste 'dutic sisacad' — comparándolo contra el promedio oficial de SISACAD. Manda WhatsApp solo si hay algo nuevo.",
      inputSchema: {},
    },
    async () => tool(() => new AssessGradeRisk(deps).run()),
  );

  server.registerTool(
    "bridge_prefetch_exam_materials",
    {
      title: "Preparar material de examen",
      description: "Descarga y convierte a Markdown el material de los cursos con una tarea tipo examen próxima a vencer.",
      inputSchema: { daysBefore: z.number().int().positive().default(3).describe("Ventana de días antes del examen.") },
    },
    async ({ daysBefore }) =>
      tool(() => new PrefetchExamMaterials({ ...deps, daysBefore, destDir: join(BRIDGE_DIR, "materiales") }).run()),
  );

  server.registerTool(
    "bridge_cross_reference_classmates",
    {
      title: "Cruzar compañeros de curso",
      description:
        "Compara el roster oficial de un curso (DUTIC) contra los miembros del grupo de WhatsApp de ese curso (wacon), " +
        "para saber quién del grupo es realmente tu compañero. Requiere haber mapeado el curso en " +
        "~/.dutic-wacon-bridge/course-groups.json.",
      inputSchema: { courseId: z.number().int().describe("courseId de dutic (ver dutic courses --json).") },
    },
    async ({ courseId }) => tool(() => new CrossReferenceClassmates(deps).run(courseId)),
  );

  server.registerTool(
    "bridge_get_study_advice",
    {
      title: "Asesor de estudio (NotebookLM)",
      description:
        "Pide consejo de estudio para un curso citando material real: consulta el NotebookLM que tengas vinculado al " +
        "grupo de WhatsApp de ese curso (wacon consultPlaybook). Requiere: 1) el curso mapeado en course-groups.json, " +
        "2) el chat etiquetado con 'wacon tag', 3) el tag mapeado a un notebook en ~/.wacon/notebooks.json. Si falta " +
        "algo, degrada con una nota explicando qué, en vez de fallar.",
      inputSchema: {
        courseId: z.number().int().describe("courseId de dutic."),
        topic: z.string().describe("Sobre qué necesitas consejo, ej. 'cómo resolver la práctica de integrales'."),
      },
    },
    async ({ courseId, topic }) => tool(() => new GetStudyAdvice(deps).run(courseId, topic)),
  );

  server.registerTool(
    "bridge_get_course_digest",
    {
      title: "Digest del grupo de un curso",
      description:
        "Resumen comprimido de la actividad reciente en el grupo de WhatsApp de un curso (cuántos mensajes, último " +
        "preview) sin leer el chat entero. Requiere el curso mapeado en course-groups.json.",
      inputSchema: {
        courseId: z.number().int().describe("courseId de dutic."),
        sinceMinutes: z.number().int().positive().default(1440).describe("Ventana hacia atrás, en minutos (default 24h)."),
      },
    },
    async ({ courseId, sinceMinutes }) => tool(() => new GetCourseDigest(deps).run(courseId, sinceMinutes)),
  );

  server.registerTool(
    "bridge_get_course_teachers",
    {
      title: "Docentes de un curso",
      description: "Lista los docentes de un curso (nombre, deducido de contactos y de quién califica en Moodle).",
      inputSchema: { courseId: z.number().int().describe("courseId de dutic.") },
    },
    async ({ courseId }) => tool(() => new GetCourseTeachers(deps).run(courseId)),
  );

  server.registerTool(
    "bridge_list_courses",
    {
      title: "Listar cursos matriculados",
      description: "Tus cursos con su courseId — útil antes de llamar cualquier tool que pida un courseId.",
      inputSchema: {},
    },
    async () => tool(() => new ListCourses(deps).run()),
  );

  server.registerTool(
    "bridge_pull_all_materials",
    {
      title: "Descargar todo el material de un curso",
      description:
        "Descarga TODOS los archivos de un curso (más amplio que bridge_prefetch_exam_materials, que solo mira " +
        "exámenes próximos) — útil al inicio de semestre o antes de un final que abarca todo el curso.",
      inputSchema: { courseId: z.number().int().describe("courseId de dutic.") },
    },
    async ({ courseId }) =>
      tool(() => new PullAllCourseMaterials({ ...deps, destDir: join(BRIDGE_DIR, "materiales-completos") }).run(courseId)),
  );

  server.registerTool(
    "bridge_export_calendar",
    {
      title: "Exportar calendario .ics",
      description: "Genera un .ics con tus entregas pendientes y lo manda por WhatsApp, para importar al calendario del teléfono.",
      inputSchema: {},
    },
    async () => tool(() => new ExportCalendar({ ...deps, destPath: deps.calendarPath }).run()),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(`dutic-wacon-mcp fatal: ${err.stack ?? err.message}`);
  process.exit(1);
});
