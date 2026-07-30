import { isBridgeReminder, buildReminderText } from "../../domain/entities/Reminder.mjs";
import { parseCommand } from "../../domain/entities/Command.mjs";
import { isDailyBriefDue, limaDateStr } from "../../domain/services/DailyScheduleClock.mjs";

const DEFAULT_TRIGGER_TIMEOUT_SECONDS = 20; // corto a propósito: también marca el ritmo del sondeo de comandos
const COMMAND_POLL_LIMIT = 15;
const DAILY_BRIEF_RETRY_GAP_MS = 15 * 60_000;

/**
 * Una iteración del proceso siempre-vivo: hace long-poll a wait_for_triggers
 * para los recordatorios, y por separado sondea tu propio chat en busca de
 * comandos —
 *  1. Recordatorios: por cada evento propio cuya hora de aviso llegó, manda
 *     el WhatsApp que el motor proactivo de wacon NUNCA manda solo.
 *  2. Comandos: wacon descarta a propósito tus propios mensajes de
 *     wait_for_triggers ("nuestros envíos nunca despiertan a un agente"),
 *     así que los comandos que TÚ te escribes se leen aparte, vía
 *     readMessages sobre el chat configurado (TargetChatPort) — el
 *     historial sí los guarda.
 */
export class RunListenerCycle {
  constructor({
    triggerSource,
    messageHistory,
    notifier,
    targetChat,
    stateRepository,
    logger,
    commandHandlers,
    dailyBrief,
    timeoutSeconds = DEFAULT_TRIGGER_TIMEOUT_SECONDS,
  }) {
    this.triggerSource = triggerSource;
    this.messageHistory = messageHistory;
    this.notifier = notifier;
    this.targetChat = targetChat;
    this.stateRepository = stateRepository;
    this.logger = logger;
    this.commandHandlers = commandHandlers;
    this.dailyBrief = dailyBrief;
    this.timeoutSeconds = timeoutSeconds;
  }

  async runOnce() {
    const state = await this.stateRepository.load();
    state.triggerListener ??= { msgCursor: undefined, triggerCursor: undefined };

    const result = await this.triggerSource.waitForTriggers({
      msgCursor: state.triggerListener.msgCursor,
      triggerCursor: state.triggerListener.triggerCursor,
      timeoutSeconds: this.timeoutSeconds,
    });

    const firedReminders = result.triggers.filter(isBridgeReminder);
    for (const trigger of firedReminders) {
      await this.notifier.notify(buildReminderText(trigger)).catch((e) => this.logger.log(`notify (recordatorio) falló: ${e.message}`));
    }

    state.triggerListener = { msgCursor: result.msgCursor, triggerCursor: result.triggerCursor };
    const executedCommands = await this.pollCommands(state);
    const sentDailyBrief = await this.maybeSendDailyBrief(state);
    await this.stateRepository.save(state);

    if (firedReminders.length) this.logger.log(`Recordatorios disparados: ${firedReminders.length}.`);
    return { firedReminders: firedReminders.length, executedCommands, sentDailyBrief, timedOut: result.timedOut };
  }

  /**
   * Manda el brief solo (sin que se pida) una vez al día, pasada la hora
   * configurada. La fecha se marca recién cuando el envío salió bien: antes se
   * marcaba primero, así que un fallo transitorio (dutic sin sesión a las 7am)
   * consumía el brief de todo el día.
   *
   * Como contrapeso, entre intentos se espera un rato: generar el brief cuesta
   * varios minutos de llamadas a dutic, y reintentar en cada ciclo de 20 s
   * martillaría la fuente todo el día si el fallo es permanente.
   */
  async maybeSendDailyBrief(state) {
    if (!this.dailyBrief) return false;
    if (!isDailyBriefDue(this.dailyBrief.hour, state.lastDailyBriefDate)) return false;
    if (state.lastDailyBriefAttemptTs && Date.now() - state.lastDailyBriefAttemptTs < DAILY_BRIEF_RETRY_GAP_MS) return false;

    state.lastDailyBriefAttemptTs = Date.now();
    const text = await this.dailyBrief.generate().catch((e) => {
      this.logger.log(`brief diario falló al generarse: ${e.message}. Se reintenta en ${DAILY_BRIEF_RETRY_GAP_MS / 60_000} min.`);
      return null;
    });
    if (!text) return false;

    const sent = await this.notifier
      .notify(`☀️ *Brief del día*\n\n${text}`)
      .then(() => true)
      .catch((e) => {
        this.logger.log(`notify (brief diario) falló: ${e.message}. Se reintenta en ${DAILY_BRIEF_RETRY_GAP_MS / 60_000} min.`);
        return false;
      });
    if (!sent) return false;

    state.lastDailyBriefDate = limaDateStr();
    this.logger.log("Brief diario mandado.");
    return true;
  }

  /** Revisa el chat configurado en busca de mensajes tuyos nuevos con "!comando". */
  async pollCommands(state) {
    if (!this.commandHandlers || !this.messageHistory) return 0;
    const chatJid = await this.targetChat.getChatJid();
    if (!chatJid) return 0;

    const recent = await this.messageHistory.readRecent({ chatJid, limit: COMMAND_POLL_LIMIT }).catch((e) => {
      this.logger.log(`readMessages (comandos) falló: ${e.message}`);
      return [];
    });

    // Primera corrida (o tras un reset de estado): establece la línea base sin
    // reaccionar a mensajes viejos que ya estaban en el historial.
    //
    // `m.timestamp` viene en MILISEGUNDOS, igual que Date.now(): wacon guarda
    // toMillis(messageTimestamp) al ingerir (core/connection.ts). De eso depende
    // toda la comparación de acá abajo — si algún día wacon pasara a segundos,
    // la línea base quedaría siempre en el futuro y ningún comando se
    // ejecutaría, sin ningún error visible.
    if (state.lastCommandTs == null) {
      state.lastCommandTs = recent.reduce((max, m) => Math.max(max, m.timestamp), Date.now());
      return 0;
    }

    const lastSeenTs = state.lastCommandTs;
    const newOwnMessages = recent
      .filter((m) => m.fromMe && m.timestamp > lastSeenTs)
      .sort((a, b) => a.timestamp - b.timestamp);

    let executed = 0;
    for (const message of newOwnMessages) {
      state.lastCommandTs = message.timestamp;
      const command = parseCommand(message.text);
      if (!command) continue;

      executed += 1;
      this.logger.log(`Comando recibido: !${command.name} ${command.args.join(" ")}`.trim());
      const handler = this.commandHandlers[command.name];
      const reply = handler
        ? await handler(command.args).catch((e) => `⚠️ Error ejecutando !${command.name}: ${e.message}`)
        : `❓ Comando desconocido: !${command.name}. Escribe !ayuda para ver la lista.`;
      await this.notifier.notify(reply).catch((e) => this.logger.log(`notify (respuesta a comando) falló: ${e.message}`));
    }
    return executed;
  }
}
