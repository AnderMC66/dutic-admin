import { MediaReaderPort } from "../../application/ports/MediaReaderPort.mjs";

/**
 * Lee notas de voz e imágenes vía wacon — cuando se puede.
 *
 * wacon entrega el contenido en dos modos (core/service.ts): si hay un backend
 * de transcripción/visión configurado devuelve texto; si no, devuelve el audio
 * o la imagen en base64 esperando que del otro lado haya un modelo que los
 * procese. Este bridge es un proceso Node sin modelo, así que ese segundo modo
 * es "no pude leerlo" — y decirlo es justamente el punto: un anuncio de
 * prórroga en un audio no puede seguir contando como silencio.
 */
export class WaconMediaReaderAdapter extends MediaReaderPort {
  constructor(client, logger) {
    super();
    this.client = client;
    this.logger = logger;
  }

  async readMedia({ chatJid, messageId, type }) {
    const method = type === "audio" ? "transcribeAudio" : type === "image" ? "viewImage" : null;
    if (!method) return { readable: false, text: null, reason: `tipo "${type}" no soportado` };

    let result;
    try {
      result = await this.client.rpc(method, [chatJid, messageId]);
    } catch (err) {
      this.logger?.log(`${method} falló para ${messageId}: ${err.message}`);
      return { readable: false, text: null, reason: err.message };
    }

    if (!result?.ok) return { readable: false, text: null, reason: result?.guidance ?? "wacon no pudo abrir el medio" };

    // Audio con backend de transcripción configurado.
    if (result.mode === "transcript" && result.text) return { readable: true, text: result.text };
    // Imagen con backend de visión configurado.
    if (result.description) return { readable: true, text: result.description };

    return {
      readable: false,
      text: null,
      reason: "wacon devolvió el medio crudo: hace falta un backend de transcripción/visión ('wacon doctor')",
    };
  }
}
