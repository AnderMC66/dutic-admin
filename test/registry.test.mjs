/**
 * El registro de comandos es ahora la única fuente de la lista de comandos, así
 * que estos tests son la red que evita que una puerta de entrada quede
 * desincronizada de las otras.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = pathToFileURL(join(import.meta.dirname, "..", "src")).href;
const { COMMAND_REGISTRY, findCommand, parsePositionalArgs, usageOf, buildHelpText, shortCourseLabel } = await import(
  `${SRC}/interfaces/commands/registry.mjs`
);
const { buildCommandHandlers } = await import(`${SRC}/interfaces/commands/commandHandlers.mjs`);

test("cada comando declara lo que las cuatro puertas necesitan", () => {
  for (const command of COMMAND_REGISTRY) {
    assert.ok(command.name, "nombre");
    assert.ok(command.category, `${command.name}: categoría (la usa el menú)`);
    assert.ok(command.label, `${command.name}: etiqueta (la usan el menú y las ayudas)`);
    assert.ok(Array.isArray(command.args), `${command.name}: args`);
    assert.equal(typeof command.execute, "function", `${command.name}: execute`);
    assert.equal(typeof command.format, "function", `${command.name}: format`);
    for (const arg of command.args) {
      assert.ok(arg.name, `${command.name}: cada arg necesita nombre`);
      assert.ok(arg.prompt, `${command.name}/${arg.name}: prompt para el menú`);
      assert.equal(typeof arg.parse, "function", `${command.name}/${arg.name}: parse`);
    }
  }
});

test("los tools de MCP están completos y sin nombres repetidos", () => {
  const nombres = new Set();
  for (const command of COMMAND_REGISTRY) {
    if (!command.mcp) continue;
    assert.match(command.mcp.name, /^bridge_/, `${command.name}: el tool debe llamarse bridge_*`);
    assert.ok(command.mcp.title, `${command.name}: título`);
    assert.ok(command.mcp.description?.length > 40, `${command.name}: descripción útil para un agente`);
    assert.ok(command.mcp.inputSchema, `${command.name}: inputSchema (aunque sea {})`);
    assert.ok(!nombres.has(command.mcp.name), `tool duplicado: ${command.mcp.name}`);
    nombres.add(command.mcp.name);
  }
  assert.equal(nombres.size, 11, "los 11 tools de siempre");
});

test("el esquema de MCP y los args posicionales usan los mismos nombres de campo", () => {
  // Si divergen, `execute` recibiría el argumento con otro nombre según la puerta
  // por la que entró y quedaría undefined en una de las dos.
  for (const command of COMMAND_REGISTRY) {
    if (!command.mcp) continue;
    const schemaKeys = Object.keys(command.mcp.inputSchema);
    for (const arg of command.args) {
      assert.ok(schemaKeys.includes(arg.name), `${command.name}: "${arg.name}" está en args pero no en el inputSchema de MCP`);
    }
  }
});

test("los handlers exponen exactamente los comandos del registro, más la ayuda", () => {
  const handlers = buildCommandHandlers({});
  for (const command of COMMAND_REGISTRY) assert.equal(typeof handlers[command.name], "function", command.name);
  assert.equal(typeof handlers.ayuda, "function");
  assert.equal(typeof handlers.help, "function");
  assert.equal(Object.keys(handlers).length, COMMAND_REGISTRY.length + 2);
});

test("la ayuda se deriva del registro (nada escrito a mano que pueda quedar viejo)", async () => {
  const ayuda = await buildCommandHandlers({}).ayuda();
  for (const command of COMMAND_REGISTRY) {
    assert.ok(ayuda.includes(`!${command.name}`), `la ayuda de WhatsApp menciona !${command.name}`);
  }
  assert.ok(ayuda.includes("!ayuda"));

  const ayudaCli = buildHelpText({ prefix: "  ", header: "Comandos:" });
  for (const command of COMMAND_REGISTRY) assert.ok(ayudaCli.includes(command.name), `la ayuda de la CLI menciona ${command.name}`);
});

test("usageOf se arma desde args, distinguiendo opcionales", () => {
  assert.equal(usageOf(findCommand("brief")), "Uso: brief");
  assert.equal(usageOf(findCommand("docentes")), "Uso: docentes <courseId>");
  assert.equal(usageOf(findCommand("estudio")), "Uso: estudio <courseId> <tema>");
  assert.equal(usageOf(findCommand("examen")), "Uso: examen [dias]");
});

test("parsePositionalArgs valida y convierte los tipos", () => {
  assert.deepEqual(parsePositionalArgs(findCommand("docentes"), ["2279"]), { input: { courseId: 2279 }, error: null });
  assert.match(parsePositionalArgs(findCommand("docentes"), ["abc"]).error, /número entero/);
  assert.match(parsePositionalArgs(findCommand("docentes"), []).error, /Uso: docentes <courseId>/);
});

test("el último argumento se queda con el resto de la línea (temas con espacios)", () => {
  const parsed = parsePositionalArgs(findCommand("estudio"), ["2263", "cómo", "resolver", "integrales"]);
  assert.deepEqual(parsed.input, { courseId: 2263, tema: "cómo resolver integrales" });
});

test("un argumento opcional ausente no es un error", () => {
  assert.deepEqual(parsePositionalArgs(findCommand("examen"), []), { input: {}, error: null });
  assert.deepEqual(parsePositionalArgs(findCommand("examen"), ["7"]), { input: { dias: 7 }, error: null });
  assert.match(parsePositionalArgs(findCommand("examen"), ["0"]).error, /entero positivo/);
});

test("un handler con argumentos mal puestos contesta el uso sin llegar al caso de uso", async () => {
  let corrio = false;
  const command = findCommand("docentes");
  const original = command.execute;
  command.execute = async () => {
    corrio = true;
  };
  try {
    const respuesta = await buildCommandHandlers({}).docentes(["no-es-numero"]);
    assert.match(respuesta, /Uso: docentes/);
    assert.equal(corrio, false, "no se toca la red si el argumento es inválido");
  } finally {
    command.execute = original;
  }
});

test("execute y format van encadenados, con el mismo input", async () => {
  const command = findCommand("docentes");
  const [originalExec, originalFormat] = [command.execute, command.format];
  command.execute = async (deps, input) => ({ courseId: input.courseId, teachers: ["ANA PEREZ"] });
  try {
    assert.match(await buildCommandHandlers({}).docentes(["2279"]), /Docentes del curso 2279:\n• ANA PEREZ/);
  } finally {
    command.execute = originalExec;
    command.format = originalFormat;
  }
});

test("shortCourseLabel saca el prefijo de semestre y carrera, y nada más", () => {
  assert.equal(shortCourseLabel("26A ECONOMÍA: ECONOMÍA POLÍTICA (E) GA"), "ECONOMÍA POLÍTICA (E) GA");
  assert.equal(shortCourseLabel("MICROECONOMÍA I GA"), "MICROECONOMÍA I GA");
});

test("el orden del registro agrupa por categoría (el menú lo numera tal cual)", () => {
  const categorias = COMMAND_REGISTRY.map((c) => c.category);
  const primeraAparicion = [...new Set(categorias)].map((cat) => categorias.indexOf(cat));
  const ultimaAparicion = [...new Set(categorias)].map((cat) => categorias.lastIndexOf(cat));
  for (const [i, cat] of [...new Set(categorias)].entries()) {
    const enRango = categorias.slice(primeraAparicion[i], ultimaAparicion[i] + 1);
    assert.ok(
      enRango.every((c) => c === cat),
      `la categoría "${cat}" está partida en el registro: el menú la mostraría dos veces`,
    );
  }
});
