/**
 * Avisa lo que cambió desde la última revisión: notas nuevas, notas que se
 * corrigieron, entregas que pasaron a calificadas, tareas nuevas y fechas
 * movidas.
 *
 * Es el evento que faltaba: el bridge sabía qué está pendiente y qué está en
 * riesgo, pero nunca te decía "te calificaron el trabajo con 15" — que además
 * cambia el cálculo de riesgo del curso.
 *
 * La fuente lleva su propia línea base y la consume al leerla, así que este
 * caso de uso NO puede ser de sólo lectura: cada corrida es "dame lo nuevo y
 * anotá que ya te lo di".
 */
export class ReportAcademicChanges {
  constructor({ academicChanges, notifier, logger }) {
    this.academicChanges = academicChanges;
    this.notifier = notifier;
    this.logger = logger;
  }

  async run() {
    const changes = await this.academicChanges.pullChanges();

    if (changes.firstRun) {
      this.logger.log("Novedades académicas: línea base guardada, sin nada que comparar todavía.");
      return { ...changes, notified: false };
    }

    const total =
      changes.newGrades.length + changes.gradeChanges.length + changes.submissionChanges.length + changes.newTasks.length + changes.dueDateChanges.length;

    this.logger.log(
      `Novedades académicas: ${changes.newGrades.length} nota(s) nueva(s), ${changes.gradeChanges.length} corregida(s), ` +
        `${changes.submissionChanges.length} entrega(s) con estado nuevo, ${changes.newTasks.length} tarea(s) nueva(s).`,
    );

    if (!total) return { ...changes, notified: false };

    await this.notifier.notify(buildMessage(changes)).catch((e) => this.logger.log(`notify (novedades) falló: ${e.message}`));
    return { ...changes, notified: true };
  }
}

function buildMessage(changes) {
  const lines = ["🔔 *Novedades académicas*:"];

  if (changes.newGrades.length) {
    lines.push(`\n🎯 Notas nuevas (${changes.newGrades.length}):`);
    for (const g of changes.newGrades) lines.push(`• ${g.courseName} — ${g.item}: *${g.grade ?? "—"}*`);
  }
  if (changes.gradeChanges.length) {
    lines.push(`\n✏️ Notas corregidas (${changes.gradeChanges.length}):`);
    for (const c of changes.gradeChanges) lines.push(`• ${c.grade.courseName} — ${c.grade.item}: ${c.from ?? "—"} → *${c.to ?? "—"}*`);
  }
  if (changes.submissionChanges.length) {
    lines.push(`\n📬 Entregas (${changes.submissionChanges.length}):`);
    for (const s of changes.submissionChanges) lines.push(`• ${s.task.courseName}: ${s.task.name} — ${s.from} → *${s.to}*`);
  }
  if (changes.newTasks.length) {
    lines.push(`\n🆕 Tareas nuevas (${changes.newTasks.length}):`);
    for (const t of changes.newTasks) lines.push(`• ${t.courseName}: ${t.name}${t.hidden ? " 👁️ (oculta)" : ""}`);
  }
  if (changes.dueDateChanges.length) {
    lines.push(`\n📅 Fechas movidas (${changes.dueDateChanges.length}):`);
    for (const d of changes.dueDateChanges) {
      const to = d.to ? new Date(d.to * 1000).toLocaleDateString("es-PE") : "sin fecha";
      lines.push(`• ${d.task.courseName}: ${d.task.name} → ${to}`);
    }
  }
  return lines.join("\n");
}
