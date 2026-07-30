#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { buildCompositionRoot } from "../../infrastructure/compositionRoot.mjs";
import { COMMAND_REGISTRY } from "../commands/registry.mjs";

/**
 * Envuelve un caso de uso en la forma que espera MCP, sin dejar que un error tumbe el server.
 * @param {() => Promise<any>} fn
 * @returns {Promise<{content: Array<{type:"text", text:string}>, isError?: boolean}>}
 */
async function toolResult(fn) {
  try {
    const data = await fn();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Error: ${err.message}` }] };
  }
}

/**
 * Servidor MCP. Los tools no se declaran uno por uno: se derivan del registro de
 * comandos (../commands/registry.mjs), el mismo que usan la CLI nativa, el panel
 * interactivo y los comandos de WhatsApp. Lo único que cambia entre puertas es
 * qué se hace con el resultado — acá se devuelve el objeto crudo, porque del otro
 * lado hay un agente; en las otras, `format()` lo vuelve texto corto.
 */
async function main() {
  const deps = await buildCompositionRoot();
  const server = new McpServer({ name: "dutic-wacon-bridge", version: "0.1.0" });

  for (const command of COMMAND_REGISTRY) {
    if (!command.mcp) continue; // comandos que sólo tienen sentido para una persona (ayuda)
    const { name, title, description, inputSchema } = command.mcp;
    server.registerTool(name, { title, description, inputSchema }, async (input) => toolResult(() => command.execute(deps, input ?? {})));
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(`dutic-wacon-mcp fatal: ${err.stack ?? err.message}`);
  process.exit(1);
});
