import { assessCourseRisk } from "../../domain/services/GradeRisk.mjs";
import { findBestCourseMatch } from "../../domain/services/CourseMatcher.mjs";

/**
 * Evalúa el riesgo de reprobar por curso (Moodle + SISACAD si ya está
 * capturado) y avisa solo cuando hay algo NUEVO — un curso que recién cruzó
 * a "atención"/"riesgo", o una discrepancia SISACAD-vs-Moodle recién
 * detectada. No repite el mismo aviso cada corrida.
 */
export class AssessGradeRisk {
  constructor({ gradesSource, sisacadSource, notifier, stateRepository, logger, passingPercentage }) {
    this.gradesSource = gradesSource;
    this.sisacadSource = sisacadSource;
    this.notifier = notifier;
    this.stateRepository = stateRepository;
    this.logger = logger;
    // El mínimo aprobatorio sale de config.json; si no viene, manda el default
    // de la UNSA que ya trae GradeRisk.
    this.riskOptions = passingPercentage ? { passingPercentage } : undefined;
  }

  async run() {
    const moodleGrades = await this.gradesSource.listAllCourseGrades();
    const sisacad = await this.sisacadSource.loadCaptured().catch((e) => {
      this.logger.log(`SISACAD no disponible: ${e.message}`);
      return null;
    });

    const state = await this.stateRepository.load();
    state.gradeRisk ??= {};

    const assessments = [];
    const newRiskAlerts = [];
    const newDiscrepancyAlerts = [];

    for (const course of moodleGrades) {
      const sisacadCourse = findBestCourseMatch(course.courseName, sisacad?.courses, (c) => c.subject);
      const assessment = assessCourseRisk(course, sisacadCourse, this.riskOptions);
      assessments.push(assessment);

      const prev = state.gradeRisk[course.courseId];
      const isConcerning = assessment.status === "riesgo" || assessment.status === "atencion";
      if (isConcerning && (!prev || prev.status !== assessment.status)) newRiskAlerts.push(assessment);
      if (assessment.discrepancy && !prev?.discrepancyFlagged) newDiscrepancyAlerts.push(assessment);

      state.gradeRisk[course.courseId] = {
        status: assessment.status,
        discrepancyFlagged: Boolean(prev?.discrepancyFlagged || assessment.discrepancy),
      };
    }

    await this.stateRepository.save(state);

    this.logger.log(
      `Riesgo de notas: ${newRiskAlerts.length} alerta(s) nueva(s), ${newDiscrepancyAlerts.length} discrepancia(s) nueva(s)` +
        (sisacad ? "" : " (sin SISACAD capturado — corre 'dutic sisacad' para comparar con la fuente oficial)"),
    );

    if (newRiskAlerts.length || newDiscrepancyAlerts.length) {
      await this.notifier
        .notify(buildMessage({ newRiskAlerts, newDiscrepancyAlerts }))
        .catch((e) => this.logger.log(`notify falló: ${e.message}`));
    }

    return { assessments, newRiskAlerts, newDiscrepancyAlerts, sisacadAvailable: Boolean(sisacad) };
  }
}

function buildMessage({ newRiskAlerts, newDiscrepancyAlerts }) {
  const lines = ["🎓 *Riesgo de notas* — novedades:"];
  if (newRiskAlerts.length) {
    lines.push(`\n${newRiskAlerts.some((a) => a.status === "riesgo") ? "🔴" : "🟡"} Cursos a vigilar:`);
    for (const a of newRiskAlerts) {
      const label = a.status === "riesgo" ? "EN RIESGO" : "cerca del mínimo";
      lines.push(`• ${a.courseName}: ${label} (~${a.referenceOn20 ?? "—"}/20, ${a.referencePercentage?.toFixed(1) ?? "—"}%)`);
    }
  }
  if (newDiscrepancyAlerts.length) {
    lines.push(`\n📊 Diferencias SISACAD vs. Moodle:`);
    for (const a of newDiscrepancyAlerts) {
      lines.push(`• ${a.courseName}: SISACAD ${a.discrepancy.sisacadPercentage}% vs. Moodle ${a.discrepancy.moodlePercentage}%`);
    }
  }
  return lines.join("\n");
}
