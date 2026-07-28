import { isPending } from "../../domain/entities/AcademicTask.mjs";
import { buildIcs } from "../../domain/services/IcsBuilder.mjs";

/** Genera un .ics con tus entregas pendientes y te lo manda por WhatsApp para importar al calendario del teléfono. */
export class ExportCalendar {
  constructor({ taskSource, fileWriter, notifier, logger, destPath }) {
    this.taskSource = taskSource;
    this.fileWriter = fileWriter;
    this.notifier = notifier;
    this.logger = logger;
    this.destPath = destPath;
  }

  async run() {
    const { tasks } = await this.taskSource.listAllTasks();
    const pending = tasks.filter(isPending);
    const ics = buildIcs(pending);

    await this.fileWriter.write({ path: this.destPath, content: ics });
    this.logger.log(`Calendario .ics generado: ${pending.length} evento(s) → ${this.destPath}`);

    await this.notifier
      .notify(`📅 Calendario con ${pending.length} entrega(s) pendiente(s) — importalo a tu calendario del teléfono.`, [this.destPath])
      .catch((e) => this.logger.log(`notify (calendario) falló: ${e.message}`));

    return { path: this.destPath, eventCount: pending.length };
  }
}
