#!/usr/bin/env node
import { ensureWaconDaemon, waconRpc } from "./waconRpc.mjs";
import { getAllTasksFromDutic } from "./duticCli.mjs";
import { loadState, saveState } from "./state.mjs";
import { findDateConflicts } from "./conflicts.mjs";
import { log } from "./log.mjs";

const CLIENT_NAME = "dutic-wacon-bridge";
const REMINDER_MINUTES_BEFORE = 24 * 60;

function toIso(dueDateSeconds) {
  return dueDateSeconds ? new Date(dueDateSeconds * 1000).toISOString() : undefined;
}

function taskTitle(task) {
  return `[DUTIC] ${task.courseName}: ${task.name}`;
}

async function main() {
  log("=== sync start ===");

  const daemonInfo = ensureWaconDaemon();
  const status = await waconRpc(daemonInfo, "status", []);
  const selfJid = status.selfJid;
  if (!selfJid) log("Aviso: wacon no tiene selfJid (¿sesión de WhatsApp caída?). Se sincroniza igual, sin poder avisar por WhatsApp.");

  let duticResult;
  try {
    duticResult = getAllTasksFromDutic();
  } catch (err) {
    log(`ERROR obteniendo tareas de DUTIC: ${err.message}`);
    if (selfJid) {
      await waconRpc(daemonInfo, "send", [
        selfJid,
        `⚠️ dutic-wacon-bridge no pudo leer tus tareas de DUTIC.\nRevisa la sesión con 'dutic status' / 'dutic login'.\nError: ${err.message}`,
        CLIENT_NAME,
        0,
      ]).catch((e) => log(`no se pudo avisar por WhatsApp: ${e.message}`));
    }
    process.exitCode = 1;
    return;
  }

  const { tasks, scanErrors } = duticResult;
  if (scanErrors?.length) log(`${scanErrors.length} curso(s) no se pudieron barrer: ${scanErrors.map((e) => e.courseName).join(", ")}`);

  const state = loadState();
  const prevTasks = state.tasks;
  const byCmid = new Map(tasks.filter((t) => t.cmid != null).map((t) => [String(t.cmid), t]));
  const newTasksState = {};
  const added = [];
  const dueChanged = [];
  const resolved = [];

  // Tareas que ya estaban trackeadas: si ya no están pendientes (entregadas,
  // calificadas o desaparecidas), cerramos su reflejo en wacon.
  for (const [cmid, prevEntry] of Object.entries(prevTasks)) {
    const current = byCmid.get(cmid);
    const stillPending = current && current.submission === "not-submitted";
    if (stillPending) continue;

    if (prevEntry.waconTaskId) {
      await waconRpc(daemonInfo, "completeTask", [prevEntry.waconTaskId]).catch((e) => log(`completeTask falló para ${cmid}: ${e.message}`));
    }
    if (prevEntry.waconEventId) {
      await waconRpc(daemonInfo, "cancelEvent", [prevEntry.waconEventId]).catch((e) => log(`cancelEvent falló para ${cmid}: ${e.message}`));
    }
    resolved.push(prevEntry.title);
  }

  // Tareas pendientes hoy: crear las nuevas, reprogramar las que cambiaron de fecha.
  for (const task of tasks) {
    if (task.submission !== "not-submitted" || task.cmid == null) continue;
    const cmid = String(task.cmid);
    const title = taskTitle(task);
    const dueIso = toIso(task.dueDate);
    const prevEntry = prevTasks[cmid];

    if (!prevEntry) {
      const taskRow = await waconRpc(daemonInfo, "addTask", [{ title, due: dueIso, notes: task.url ?? undefined }]);
      let eventId;
      if (dueIso) {
        const ev = await waconRpc(daemonInfo, "scheduleEvent", [
          { title, start: dueIso, notifyBeforeMinutes: REMINDER_MINUTES_BEFORE, notes: task.url ?? undefined },
        ]).catch((e) => {
          log(`scheduleEvent falló para ${cmid}: ${e.message}`);
          return null;
        });
        eventId = ev?.id;
      }
      newTasksState[cmid] = {
        title,
        courseName: task.courseName,
        dueDate: task.dueDate,
        submission: task.submission,
        dateConflict: task.dateConflict,
        waconTaskId: taskRow.id,
        waconEventId: eventId,
      };
      added.push(task);
      continue;
    }

    newTasksState[cmid] = { ...prevEntry, title, submission: task.submission, dateConflict: task.dateConflict };

    if (task.dueDate !== prevEntry.dueDate) {
      if (prevEntry.waconEventId) {
        await waconRpc(daemonInfo, "cancelEvent", [prevEntry.waconEventId]).catch(() => {});
      }
      let eventId;
      if (dueIso) {
        const ev = await waconRpc(daemonInfo, "scheduleEvent", [
          { title, start: dueIso, notifyBeforeMinutes: REMINDER_MINUTES_BEFORE, notes: "Fecha actualizada por DUTIC." },
        ]).catch((e) => {
          log(`scheduleEvent (update) falló para ${cmid}: ${e.message}`);
          return null;
        });
        eventId = ev?.id;
      }
      newTasksState[cmid].waconEventId = eventId;
      newTasksState[cmid].dueDate = task.dueDate;
      dueChanged.push({ task, from: prevEntry.dueDate });
    }
  }

  // Cruce: lo que el grupo de WhatsApp del curso dijo vs lo oficial en Moodle.
  const suggested = await waconRpc(daemonInfo, "listSuggestedEvents", ["suggested", 200]).catch((e) => {
    log(`listSuggestedEvents falló: ${e.message}`);
    return [];
  });
  const conflicts = findDateConflicts(tasks, suggested, state.flaggedConflicts);
  for (const c of conflicts) {
    const title = `⚠️ Conflicto de fecha: ${c.task.courseName}`;
    const notes = [
      `Tarea: ${c.task.name}`,
      `Moodle (oficial): ${new Date(c.task.dueDate * 1000).toLocaleString("es-PE")}`,
      `Grupo de WhatsApp (${c.suggested.chatName ?? "curso"}): ${new Date(c.suggested.when).toLocaleString("es-PE")}`,
      c.suggested.raw ? `Mensaje: "${c.suggested.raw}"` : null,
    ]
      .filter(Boolean)
      .join("\n");
    await waconRpc(daemonInfo, "addTask", [{ title, due: toIso(c.task.dueDate), notes }]).catch((e) => log(`addTask conflicto falló: ${e.message}`));
    state.flaggedConflicts.push(c.key);
  }

  state.tasks = newTasksState;
  saveState(state);

  log(`Resumen: +${added.length} nuevas, ${dueChanged.length} con fecha cambiada, ${resolved.length} resueltas, ${conflicts.length} conflictos.`);

  if (selfJid && (added.length || dueChanged.length || resolved.length || conflicts.length)) {
    const lines = ["📚 *DUTIC ↔ wacon* — novedades:"];
    if (added.length) {
      lines.push(`\n🆕 Nuevas (${added.length}):`);
      for (const t of added) lines.push(`• ${t.courseName}: ${t.name}${t.dueDate ? ` — ${new Date(t.dueDate * 1000).toLocaleDateString("es-PE")}` : ""}`);
    }
    if (dueChanged.length) {
      lines.push(`\n📅 Fecha cambiada (${dueChanged.length}):`);
      for (const { task } of dueChanged) lines.push(`• ${task.courseName}: ${task.name} → ${new Date(task.dueDate * 1000).toLocaleDateString("es-PE")}`);
    }
    if (resolved.length) {
      lines.push(`\n✅ Resueltas (${resolved.length}):`);
      for (const t of resolved) lines.push(`• ${t}`);
    }
    if (conflicts.length) {
      lines.push(`\n⚠️ Conflictos de fecha (${conflicts.length}) — revisa 'wacon tasks':`);
      for (const c of conflicts) lines.push(`• ${c.task.courseName}: ${c.task.name}`);
    }
    await waconRpc(daemonInfo, "send", [selfJid, lines.join("\n"), CLIENT_NAME, 0]).catch((e) => log(`no se pudo mandar el resumen por WhatsApp: ${e.message}`));
  }

  log("=== sync end ===");
}

main().catch((err) => {
  log(`ERROR fatal: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
