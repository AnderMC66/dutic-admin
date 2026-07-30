import { join } from "node:path";

import { ConsoleFileLogger } from "./logging/ConsoleFileLogger.mjs";
import { FileStateRepository } from "./persistence/FileStateRepository.mjs";
import { FileCourseGroupMap } from "./persistence/FileCourseGroupMap.mjs";
import { DuticCliTaskSource } from "./dutic/DuticCliTaskSource.mjs";
import { DuticCliAttachmentsAdapter } from "./dutic/DuticCliAttachmentsAdapter.mjs";
import { DuticCliGradesSource } from "./dutic/DuticCliGradesSource.mjs";
import { DuticCliSisacadSource } from "./dutic/DuticCliSisacadSource.mjs";
import { DuticCliMaterialsAdapter } from "./dutic/DuticCliMaterialsAdapter.mjs";
import { DuticCliPeopleSource } from "./dutic/DuticCliPeopleSource.mjs";
import { DuticCliTeachersAdapter } from "./dutic/DuticCliTeachersAdapter.mjs";
import { DuticCliCoursesAdapter } from "./dutic/DuticCliCoursesAdapter.mjs";
import { WaconDaemonClient } from "./wacon/WaconDaemonClient.mjs";
import { WaconAgendaAdapter } from "./wacon/WaconAgendaAdapter.mjs";
import { WaconNotifier } from "./wacon/WaconNotifier.mjs";
import { WaconGroupMembersAdapter } from "./wacon/WaconGroupMembersAdapter.mjs";
import { WaconBriefingAdapter } from "./wacon/WaconBriefingAdapter.mjs";
import { WaconPlaybookAdapter } from "./wacon/WaconPlaybookAdapter.mjs";
import { WaconDigestAdapter } from "./wacon/WaconDigestAdapter.mjs";
import { WaconTriggerAdapter } from "./wacon/WaconTriggerAdapter.mjs";
import { WaconIdentityAdapter } from "./wacon/WaconIdentityAdapter.mjs";
import { WaconMessageHistoryAdapter } from "./wacon/WaconMessageHistoryAdapter.mjs";
import { FileTargetChatConfig } from "./persistence/FileTargetChatConfig.mjs";
import { NodeFileWriterAdapter } from "./persistence/NodeFileWriterAdapter.mjs";
import { FileRunLock } from "./persistence/FileRunLock.mjs";
import { CachedAcademicTaskSource, CachedGradesSource } from "./caching/CachedSources.mjs";
import { BRIDGE_DIR } from "./paths.mjs";

/**
 * Punto único donde se arman los adaptadores concretos. Los tres entrypoints
 * (cron, reminder-listener, servidor MCP) necesitan casi el mismo grafo de
 * dependencias — esto evita cablearlo tres veces.
 */
export async function buildCompositionRoot() {
  const logger = new ConsoleFileLogger();
  // Sin ensureDaemon() acá a propósito: armar el grafo no debe tocar la red ni
  // spawnear nada. `rpc()` levanta el daemon la primera vez que alguien lo
  // necesita, así que un comando que solo usa dutic (`duticbat cursos`) sigue
  // funcionando con WhatsApp caído, en vez de fallar entero al arrancar.
  const waconClient = new WaconDaemonClient(logger);

  const identity = new WaconIdentityAdapter(waconClient);
  const targetChat = new FileTargetChatConfig(identity, logger);

  return {
    logger,
    waconClient,
    agenda: new WaconAgendaAdapter(waconClient),
    notifier: new WaconNotifier(waconClient, targetChat, logger),
    // Envueltos en un caché de 60 s: `dutic tasks` y `dutic grades` son las dos
    // llamadas más caras (timeouts de 5 y 3 min) y varios casos de uso las piden
    // dos veces en la misma corrida.
    taskSource: new CachedAcademicTaskSource(new DuticCliTaskSource()),
    gradesSource: new CachedGradesSource(new DuticCliGradesSource()),
    sisacadSource: new DuticCliSisacadSource(),
    materials: new DuticCliMaterialsAdapter(),
    people: new DuticCliPeopleSource(),
    attachments: new DuticCliAttachmentsAdapter(),
    attachmentsDestDir: join(BRIDGE_DIR, "adjuntos"),
    groupMembers: new WaconGroupMembersAdapter(waconClient),
    socialBriefing: new WaconBriefingAdapter(waconClient),
    playbook: new WaconPlaybookAdapter(waconClient),
    digest: new WaconDigestAdapter(waconClient),
    teachersSource: new DuticCliTeachersAdapter(),
    coursesSource: new DuticCliCoursesAdapter(),
    triggerSource: new WaconTriggerAdapter(waconClient),
    identity,
    targetChat,
    messageHistory: new WaconMessageHistoryAdapter(waconClient),
    fileWriter: new NodeFileWriterAdapter(),
    // Todas las rutas de salida viven acá, no en las puertas de entrada: antes
    // "materiales" y "materiales-completos" estaban hardcodeados por duplicado en
    // server.mjs y en commandHandlers.mjs, y sólo calendarPath estaba centralizado.
    calendarPath: join(BRIDGE_DIR, "calendario.ics"),
    examMaterialsDir: join(BRIDGE_DIR, "materiales"),
    allMaterialsDir: join(BRIDGE_DIR, "materiales-completos"),
    stateRepository: new FileStateRepository(),
    runLock: new FileRunLock(),
    courseGroupMap: new FileCourseGroupMap(logger),
  };
}
