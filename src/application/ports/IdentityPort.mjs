/** Tu propio JID de WhatsApp — necesario para saber que un mensaje es tuyo, no de otra persona. */
export class IdentityPort {
  /** @returns {Promise<string|null>} */
  async getSelfJid() {
    throw new Error("not implemented");
  }
}
