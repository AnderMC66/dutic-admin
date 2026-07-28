/**
 * Evalúa qué tan cerca está un curso de reprobar, combinando el total que
 * calcula Moodle con (si existe) el promedio ponderado de SISACAD — la
 * fuente oficial. Puro: solo compara números ya obtenidos.
 *
 * Importante: el `total` crudo de Moodle NO está en una escala fija — cada
 * curso puede configurar su propio máximo de puntos (visto en producción:
 * un curso sobre 15, otro sobre 120, otro sobre 140). La única magnitud
 * comparable entre cursos —y contra el 0-20 oficial de SISACAD— es el
 * PORCENTAJE, así que todo el cálculo vive ahí.
 */

const DEFAULT_PASSING_PERCENTAGE = 52.5; // 10.5/20, el mínimo aprobatorio de la UNSA, en %
const DEFAULT_WARN_MARGIN_PERCENTAGE = 10; // a menos de 10 puntos porcentuales: "atención"
const DEFAULT_DISCREPANCY_PERCENTAGE_POINTS = 7; // diferencia SISACAD vs Moodle que vale la pena avisar

/** "16,00" / "45,50 %" → 16 / 45.5. null si no hay nota (pendiente/vacía). */
export function parseGradeNumber(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace("%", "").trim().replace(",", ".");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Promedio ponderado de SISACAD (siempre 0-20) expresado como porcentaje. */
function sisacadToPercentage(weightedAverageSoFar) {
  return weightedAverageSoFar == null ? null : (weightedAverageSoFar / 20) * 100;
}

/**
 * @param {{courseId:number, courseName:string, total:string|null, totalPercentage:string|null}} courseGrades
 * @param {{weightedAverageSoFar:number|null}|null} sisacadCourse
 */
export function assessCourseRisk(
  courseGrades,
  sisacadCourse,
  {
    passingPercentage = DEFAULT_PASSING_PERCENTAGE,
    warnMarginPercentage = DEFAULT_WARN_MARGIN_PERCENTAGE,
    discrepancyPercentagePoints = DEFAULT_DISCREPANCY_PERCENTAGE_POINTS,
  } = {},
) {
  const moodlePercentage = parseGradeNumber(courseGrades.totalPercentage);
  const sisacadPercentage = sisacadToPercentage(sisacadCourse?.weightedAverageSoFar ?? null);
  // SISACAD es la fuente oficial; si está disponible, manda sobre el cálculo de Moodle.
  const referencePercentage = sisacadPercentage ?? moodlePercentage;

  let status = "sin_datos";
  if (referencePercentage != null) {
    if (referencePercentage < passingPercentage) status = "riesgo";
    else if (referencePercentage < passingPercentage + warnMarginPercentage) status = "atencion";
    else status = "ok";
  }

  const discrepancy =
    moodlePercentage != null && sisacadPercentage != null && Math.abs(moodlePercentage - sisacadPercentage) >= discrepancyPercentagePoints
      ? {
          moodlePercentage: Number(moodlePercentage.toFixed(1)),
          sisacadPercentage: Number(sisacadPercentage.toFixed(1)),
          diff: Number((sisacadPercentage - moodlePercentage).toFixed(1)),
        }
      : null;

  return {
    courseId: courseGrades.courseId,
    courseName: courseGrades.courseName,
    moodlePercentage,
    sisacadPercentage,
    referencePercentage,
    // equivalente 0-20 solo para mostrar, nunca para comparar
    referenceOn20: referencePercentage != null ? Number(((referencePercentage / 100) * 20).toFixed(2)) : null,
    status,
    discrepancy,
  };
}
