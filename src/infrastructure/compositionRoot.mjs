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
import { BRIDGE_DIR } from "./paths.mjs";

/**
 * Punto único donde se arman los adaptadores concretos. Los tres entrypoints
 * (cron, reminder-listener, servidor MCP) necesitan casi el mismo grafo de
 * dependencias — esto evita cablearlo tres veces.
 */
export async function buildCompositionRoot() {
  const logger = new ConsoleFileLogger();
  const waconClient = new WaconDaemonClient(logger);
  await waconClient.ensureDaemon();

  const identity = new WaconIdentityAdapter(waconClient);
  const targetChat = new FileTargetChatConfig(identity);

  return {
    logger,
    waconClient,
    agenda: new WaconAgendaAdapter(waconClient),
    notifier: new WaconNotifier(waconClient, targetChat, logger),
    taskSource: new DuticCliTaskSource(),
    gradesSource: new DuticCliGradesSource(),
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
    calendarPath: join(BRIDGE_DIR, "calendario.ics"),
    stateRepository: new FileStateRepository(),
    courseGroupMap: new FileCourseGroupMap(),
  };
}
