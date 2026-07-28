import { isPending, isExamTask, isDueWithin } from "../../domain/entities/AcademicTask.mjs";

const DEFAULT_DAYS_BEFORE = 3;

/**
 * Cuando una tarea pendiente huele a examen (nombre con "examen"/"parcial"/
 * "evaluación") y vence dentro de pocos días, descarga y convierte el
 * material del curso de una vez — para que ya esté listo en Markdown en vez
 * de que tengas que entrar a Moodle a buscarlo la noche anterior.
 */
export class PrefetchExamMaterials {
  constructor({ taskSource, materials, notifier, stateRepository, logger, daysBefore = DEFAULT_DAYS_BEFORE, destDir }) {
    this.taskSource = taskSource;
    this.materials = materials;
    this.notifier = notifier;
    this.stateRepository = stateRepository;
    this.logger = logger;
    this.daysBefore = daysBefore;
    this.destDir = destDir;
  }

  async run() {
    const { tasks } = await this.taskSource.listAllTasks();
    const state = await this.stateRepository.load();
    state.examMaterialsFetched ??= [];

    const candidates = tasks.filter(
      (t) => isPending(t) && isExamTask(t) && isDueWithin(t, this.daysBefore) && !state.examMaterialsFetched.includes(String(t.cmid)),
    );

    const fetched = [];
    for (const task of candidates) {
      try {
        const { dest, summary } = await this.materials.prepareCourseMaterials({ courseId: task.courseId, dest: this.destDir });
        state.examMaterialsFetched.push(String(task.cmid));
        fetched.push({ task, dest, summary });
      } catch (err) {
        this.logger.log(`prepareCourseMaterials falló para curso ${task.courseId}: ${err.message}`);
      }
    }

    await this.stateRepository.save(state);
    this.logger.log(`Material de examen: ${fetched.length} curso(s) preparado(s) de ${candidates.length} candidato(s).`);

    if (fetched.length) {
      await this.notifier.notify(buildMessage(fetched)).catch((e) => this.logger.log(`notify falló: ${e.message}`));
    }
    return { fetched, candidates: candidates.length };
  }
}

function buildMessage(fetched) {
  const lines = ["📖 *Material de examen listo*:"];
  for (const f of fetched) {
    const when = f.task.dueDate ? new Date(f.task.dueDate * 1000).toLocaleDateString("es-PE") : "sin fecha";
    lines.push(`• ${f.task.courseName}: ${f.task.name} (${when})`);
    lines.push(`  → ${f.dest}`);
  }
  return lines.join("\n");
}
