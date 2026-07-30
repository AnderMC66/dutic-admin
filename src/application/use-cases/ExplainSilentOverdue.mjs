import { messagesAroundDue, splitByReadability } from "../../domain/services/ChatterWindow.mjs";
import { mentionsExtension } from "../../domain/services/OverdueAnalyzer.mjs";

const MESSAGES_TO_SCAN = 200;
const MAX_MEDIA_TO_READ = 8;

/**
 * Mira el grupo del curso alrededor del vencimiento de una tarea que quedó
 * "vencida en silencio", para no acusar de silencio lo que sí se dijo.
 *
 * El detector original sólo lee el TEXTO de los eventos que wacon ya extrajo.
 * En un grupo de curso real, buena parte de los anuncios ("el profe dijo que lo
 * recibe hasta el lunes") son notas de voz o una foto de la pizarra, que
 * llegaban como mensajes vacíos: indistinguibles de que nadie hubiera dicho
 * nada.
 *
 * Acá se resuelven tres estados distintos, que antes eran uno solo:
 *  - `explained`: alguien lo dijo, y lo pudimos leer.
 *  - `unreadable`: hay audios/imágenes en la ventana que NO se pudieron leer
 *    (wacon devuelve el medio crudo si no hay backend de transcripción/visión).
 *    No es silencio: es "no puedo saberlo, revisá el grupo".
 *  - silencio de verdad: no hubo nada.
 */
export class ExplainSilentOverdue {
  constructor({ courseGroupMap, messageHistory, mediaReader, logger }) {
    this.courseGroupMap = courseGroupMap;
    this.messageHistory = messageHistory;
    this.mediaReader = mediaReader;
    this.logger = logger;
  }

  /** @param {Array<{task:object}>} silentOverdue lo que devolvió findSilentOverdue, ya filtrado a los silenciosos */
  async run(silentOverdue) {
    if (!this.courseGroupMap || !this.messageHistory) return silentOverdue.map((o) => ({ ...o, inspected: false }));

    const results = [];
    for (const entry of silentOverdue) {
      results.push(await this.inspect(entry).catch((err) => {
        this.logger?.log(`No se pudo revisar el grupo de "${entry.task.name}": ${err.message}`);
        return { ...entry, inspected: false };
      }));
    }
    return results;
  }

  async inspect(entry) {
    const task = entry.task;
    const chatJid = await this.courseGroupMap.getChatForCourse(task.courseId);
    if (!chatJid) return { ...entry, inspected: false, reason: "curso sin grupo mapeado" };

    const recent = await this.messageHistory.readRecent({ chatJid, limit: MESSAGES_TO_SCAN });
    const window = messagesAroundDue(recent, task.dueDate);
    const { text, media } = splitByReadability(window);

    // Texto: lo barato primero.
    const spokenInText = text.find((m) => mentionsExtension(m.text));
    if (spokenInText) {
      return { ...entry, inspected: true, explained: true, evidence: spokenInText.text.slice(0, 200), source: "texto" };
    }

    // Medios: sólo si hay con qué leerlos.
    let unreadable = 0;
    for (const m of media.slice(0, MAX_MEDIA_TO_READ)) {
      const read = this.mediaReader ? await this.mediaReader.readMedia({ chatJid, messageId: m.id, type: m.type }) : { readable: false };
      if (!read.readable) {
        unreadable += 1;
        continue;
      }
      if (mentionsExtension(read.text)) {
        return { ...entry, inspected: true, explained: true, evidence: read.text.slice(0, 200), source: m.type };
      }
    }

    return {
      ...entry,
      inspected: true,
      explained: false,
      // Lo importante: distinguir "nadie dijo nada" de "no pude oír lo que dijeron".
      unreadableMedia: unreadable,
      messagesInWindow: window.length,
    };
  }
}
