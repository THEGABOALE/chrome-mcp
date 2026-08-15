/**
 * chrome-mcp entrypoint. Registers all tools and serves them over the MCP
 * stdio transport.
 *
 * stdout is reserved for JSON-RPC protocol traffic on the stdio transport —
 * all diagnostic output goes through src/logger.ts (stderr). A crash must never
 * leave Chrome orphaned, so uncaughtException/unhandledRejection and connection
 * close all funnel through shutdown() -> closeBrowser().
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { config } from "./config.js";
import { logger } from "./logger.js";
import { closeBrowser } from "./browser.js";
import type { ToolResult } from "./tools/result.js";
import * as navigation from "./tools/navigation.js";
import * as extract from "./tools/extract.js";
import * as interact from "./tools/interact.js";
import * as debug from "./tools/debug.js";

const emptySchema = z.object({});

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<ToolResult>;
}

/**
 * The tool registry. Descriptions are what the model reads to choose a tool —
 * they state when to use each one and when to prefer another.
 */
const TOOLS: ToolDefinition[] = [
  {
    name: "navigate",
    description:
      "Navega la pestaña activa a una URL. Úsala para abrir una página o " +
      "cambiar de sitio. Espera a que la carga alcance el estado waitUntil " +
      "('load' por defecto; 'domcontentloaded' para no esperar imágenes y " +
      "subrecursos; 'networkidle' para SPAs que cargan datos tras el HTML). " +
      "Devuelve el título y la URL final (útil si hubo redirect). Respeta la " +
      "lista de dominios permitidos si está configurada.",
    inputSchema: navigation.navigateInputSchema,
    handler: navigation.navigate,
  },
  {
    name: "go_back",
    description:
      "Vuelve a la página anterior del historial de la pestaña activa, como el " +
      "botón Atrás. Si no hay página anterior, lo indica sin error. Para ir a " +
      "una URL concreta usa navigate, no esta tool.",
    inputSchema: emptySchema,
    handler: navigation.goBack,
  },
  {
    name: "go_forward",
    description:
      "Avanza a la página siguiente del historial (como el botón Adelante), " +
      "tras haber usado go_back. Si no hay página siguiente, lo indica sin error.",
    inputSchema: emptySchema,
    handler: navigation.goForward,
  },
  {
    name: "reload",
    description:
      "Recarga la página actual de la pestaña activa (como F5). Útil tras " +
      "cambios de estado en el servidor o para reintentar una carga fallida.",
    inputSchema: emptySchema,
    handler: navigation.reload,
  },
  {
    name: "list_tabs",
    description:
      "Lista las pestañas abiertas con su id, título y URL. Usa el id devuelto " +
      "como 'tabId' en otras tools para operar sobre una pestaña concreta en " +
      "vez de la activa.",
    inputSchema: emptySchema,
    handler: navigation.listTabs,
  },
  {
    name: "read_page",
    description:
      "Extrae el contenido de la página actual. Usa mode='markdown' para " +
      "artículos/texto legible (el caso más común), mode='text' si markdown " +
      "falla o necesitas texto plano exacto, mode='html' solo si necesitas la " +
      "estructura HTML cruda para depurar selectores. Acepta tabId opcional. " +
      "El contenido se trunca si es muy largo.",
    inputSchema: extract.readPageInputSchema,
    handler: extract.readPage,
  },
  {
    name: "screenshot",
    description:
      "Captura una imagen de la página (o de un elemento si pasas 'selector'). " +
      "Usa fullPage=true para capturar toda la página desplazable, no solo lo " +
      "visible. Devuelve PNG (o JPEG si es muy grande). Úsala para inspeccionar " +
      "visualmente el estado de la página o confirmar que algo se renderizó.",
    inputSchema: extract.screenshotInputSchema,
    handler: extract.screenshot,
  },
  {
    name: "query_elements",
    description:
      "Busca elementos por selector CSS y devuelve, por coincidencia, su texto " +
      "y los atributos id, class y href. Úsala para descubrir o verificar " +
      "selectores antes de un click/fill, o para leer una lista de elementos. " +
      "Devuelve hasta 'limit' resultados (20 por defecto). Si no hay " +
      "coincidencias, lo dice explícitamente.",
    inputSchema: extract.queryElementsInputSchema,
    handler: extract.queryElements,
  },
  {
    name: "click",
    description:
      "Hace click en el elemento que coincide con el selector CSS en la " +
      "pestaña indicada. Espera a que sea visible y habilitado; si está oculto, " +
      "deshabilitado o tapado por otro elemento, lo reporta explícitamente. " +
      "Respeta la lista de dominios permitidos. Para escribir texto usa fill.",
    inputSchema: interact.clickInputSchema,
    handler: interact.click,
  },
  {
    name: "fill",
    description:
      "Rellena un campo (input/textarea/contenteditable) con 'value', " +
      "reemplazando su contenido. NO envía el formulario ni presiona Enter: " +
      "solo llena el campo. Para enviar, usa después press_key con 'Enter' o " +
      "haz click en el botón de submit. Respeta la lista de dominios permitidos.",
    inputSchema: interact.fillInputSchema,
    handler: interact.fill,
  },
  {
    name: "press_key",
    description:
      "Presiona una tecla o combinación sobre el foco actual (ej. 'Enter', " +
      "'Tab', 'Escape', 'Control+A'). Útil para enviar formularios tras fill, " +
      "mover el foco o atajos de teclado. No hace click ni cambia el foco por sí " +
      "sola.",
    inputSchema: interact.pressKeyInputSchema,
    handler: interact.pressKey,
  },
  {
    name: "wait_for",
    description:
      "Espera hasta que el elemento del selector esté visible, o hasta " +
      "timeoutMs (por defecto el timeout global). Úsala tras una acción que " +
      "dispara carga asíncrona (navegación de SPA, contenido diferido) antes de " +
      "leer o interactuar, para evitar condiciones de carrera.",
    inputSchema: interact.waitForInputSchema,
    handler: interact.waitFor,
  },
  {
    name: "scroll",
    description:
      "Desplaza la página hacia 'up' o 'down' una cantidad en píxeles ('amount', " +
      "500 por defecto). Úsala para cargar contenido con scroll infinito o traer " +
      "un elemento al viewport antes de capturarlo o interactuar con él.",
    inputSchema: interact.scrollInputSchema,
    handler: interact.scroll,
  },
  {
    name: "get_console_logs",
    description:
      "Devuelve los mensajes de consola (log/warn/error) capturados en la " +
      "pestaña desde que el servidor se conectó a ella. Úsala para depurar " +
      "errores de JavaScript del cliente. Solo incluye lo ocurrido tras la " +
      "conexión: si acabas de abrir la página, navega o recarga para capturar. " +
      "Devuelve los 'limit' más recientes (50 por defecto).",
    inputSchema: debug.getConsoleLogsInputSchema,
    handler: debug.getConsoleLogs,
  },
  {
    name: "get_network_requests",
    description:
      "Devuelve las peticiones de red capturadas en la pestaña (método, URL, " +
      "status y tiempo de respuesta). 'filter' filtra por substring de la URL " +
      "(ej. '/api/'). Úsala para depurar llamadas a APIs, ver códigos de estado " +
      "o fallos de red. Solo captura lo ocurrido tras la conexión. Devuelve las " +
      "'limit' más recientes (50 por defecto).",
    inputSchema: debug.getNetworkRequestsInputSchema,
    handler: debug.getNetworkRequests,
  },
  {
    name: "evaluate_js",
    description:
      "Ejecuta JavaScript arbitrario en la página y devuelve el resultado " +
      "serializado a JSON. Solo usar cuando ninguna otra tool cubre la " +
      "necesidad — preferir siempre click/fill/query_elements/read_page antes " +
      "que esto. Puede estar deshabilitado por configuración (ALLOW_EVAL); si lo " +
      "está, lo indicará. Es la superficie de mayor riesgo del servidor.",
    inputSchema: debug.evaluateJsInputSchema,
    handler: debug.evaluateJs,
  },
];

const toolByName = new Map(TOOLS.map((tool) => [tool.name, tool]));

function createServer(): Server {
  const server = new Server(
    { name: "chrome-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map<Tool>((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema, {
        $refStrategy: "none",
      }) as Tool["inputSchema"],
    })),
  }));

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<CallToolResult> => {
      const { name, arguments: args } = request.params;
      const tool = toolByName.get(name);
      if (!tool) {
        return {
          content: [{ type: "text", text: `Unknown tool: "${name}".` }],
          isError: true,
        };
      }
      // Tool handlers catch their own errors; this is a last-resort safety net.
      try {
        return (await tool.handler(args ?? {})) as CallToolResult;
      } catch (err) {
        logger.error(`Tool "${name}" threw unexpectedly`, err);
        return {
          content: [
            {
              type: "text",
              text: `Tool "${name}" failed unexpectedly: ${
                err instanceof Error ? err.message : String(err)
              }.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}

let shuttingDown = false;
async function shutdown(code: number, reason: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info(`Shutting down (${reason})`);
  try {
    await closeBrowser();
  } catch (err) {
    logger.error("Error closing browser during shutdown", err);
  }
  process.exit(code);
}

process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", err);
  void shutdown(1, "uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", reason);
  void shutdown(1, "unhandledRejection");
});

async function main(): Promise<void> {
  logger.info(`Starting chrome-mcp (transport=${config.transport})`);

  if (config.transport !== "stdio") {
    throw new Error(
      `Transport "${config.transport}" is not implemented yet; use TRANSPORT=stdio.`,
    );
  }

  const server = createServer();
  // Clean up Chrome when the client disconnects (stdin closes).
  server.onclose = () => {
    void shutdown(0, "connection closed");
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(
    `chrome-mcp ready over stdio (${TOOLS.length} tools registered)`,
  );
}

main().catch((err) => {
  logger.error("Fatal error during startup", err);
  void shutdown(1, "startup failure");
});
