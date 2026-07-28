import { isPending, dueDateIso } from "../../domain/entities/AcademicTask.mjs";
import { assessCourseRisk } from "../../domain/services/GradeRisk.mjs";
import { sameCourse } from "../../domain/services/CourseMatcher.mjs";
import { findDateConflicts, describeConflict } from "../../domain/services/ConflictDetector.mjs";
import { findSilentOverdue } from "../../domain/services/OverdueAnalyzer.mjs";
import { rankByStudyPriority } from "../../domain/services/StudyPriority.mjs";

/**
 * Foto completa, en vivo, de la situación académica: pendientes (ordenadas
 * por prioridad de estudio, no solo por fecha), riesgo de notas, conflictos
 * de fecha y vencidas sin aviso — la respuesta a "qué tengo pendiente" sin
 * tener que preguntarle por separado a dutic y a wacon. A diferencia de
 * SyncAcademicTasks, esto es de solo lectura: no escribe nada en la agenda
 * ni manda WhatsApp, así que se puede llamar tan seguido como se quiera
 * (p. ej. desde un tool de MCP).
 */
const DEFAULT_SOCIAL_SINCE_MINUTES = 720; // 12h, mismo default que wacon.briefing()

export class GetUnifiedBrief {
  constructor({ taskSource, gradesSource, sisacadSource, agenda, socialBriefing, logger }) {
    this.taskSource = taskSource;
    this.gradesSource = gradesSource;
    this.sisacadSource = sisacadSource;
    this.agenda = agenda;
    this.socialBriefing = socialBriefing;
    this.logger = logger;
  }

  async run() {
    const [{ tasks }, moodleGrades, sisacad, suggested, social] = await Promise.all([
      this.taskSource.listAllTasks(),
      this.gradesSource.listAllCourseGrades(),
      this.sisacadSource.loadCaptured().catch((e) => {
        this.logger?.log(`SISACAD no disponible: ${e.message}`);
        return null;
      }),
      this.agenda.listSuggestedEvents().catch((e) => {
        this.logger?.log(`listSuggestedEvents falló: ${e.message}`);
        return [];
      }),
      this.socialBriefing?.getBriefing(DEFAULT_SOCIAL_SINCE_MINUTES).catch((e) => {
        this.logger?.log(`briefing (wacon) falló: ${e.message}`);
        return null;
      }) ?? Promise.resolve(null),
    ]);

    const pending = tasks.filter(isPending);
    const gradeItemsByCourseId = new Map(moodleGrades.map((c) => [c.courseId, c.items]));
    const prioritized = rankByStudyPriority(pending, gradeItemsByCourseId);
    const gradeRisks = moodleGrades
      .map((c) => assessCourseRisk(c, sisacad?.courses.find((s) => sameCourse(s.subject, c.courseName)) ?? null))
      .filter((a) => a.status !== "sin_datos");
    const conflicts = findDateConflicts(tasks, suggested, [], 20).map(describeConflict);
    const silentOverdue = findSilentOverdue(tasks, suggested)
      .filter((o) => o.silent)
      .map((o) => ({ course: o.task.courseName, name: o.task.name, due: dueDateIso(o.task) }));

    return {
      generatedAt: new Date().toISOString(),
      sisacadAvailable: Boolean(sisacad),
      pendingTasks: prioritized.map(({ task: t, weightPercent, priorityScore }) => ({
        course: t.courseName,
        name: t.name,
        due: dueDateIso(t),
        hidden: t.hidden,
        weightPercent,
        priorityScore,
      })),
      gradeRisks,
      dateConflicts: conflicts,
      silentOverdue,
      // "Ponte al día" social de wacon (qué te falta responder, compromisos, agenda no-académica)
      // fusionado acá para no tener que preguntarle por separado a wacon.
      social: social
        ? {
            pendingReplies: social.pendingReplies,
            openCommitments: social.openCommitments,
            newSince: social.newSince,
          }
        : null,
    };
  }
}
