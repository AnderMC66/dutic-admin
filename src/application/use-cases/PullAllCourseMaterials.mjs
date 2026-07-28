/**
 * Descarga TODO el material de un curso de una vez (más amplio que
 * PrefetchExamMaterials, que solo mira exámenes próximos) — útil al
 * arrancar el semestre o antes de un final que abarca todo el curso.
 */
export class PullAllCourseMaterials {
  constructor({ materials, logger, destDir }) {
    this.materials = materials;
    this.logger = logger;
    this.destDir = destDir;
  }

  async run(courseId) {
    const dest = `${this.destDir}/${courseId}`;
    const result = await this.materials.pullAllMaterials({ courseId, dest });
    this.logger.log(`Material completo del curso ${courseId} → ${result.dest}`);
    return result;
  }
}
