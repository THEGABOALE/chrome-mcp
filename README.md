# chrome-mcp

Servidor MCP (Model Context Protocol) que controla Chrome en **Windows** a
través del DevTools Protocol, exponiendo tools de navegación, extracción de
contenido, interacción y depuración a clientes MCP como Claude Desktop.

## Qué es y por qué existe

El conector oficial de Anthropic para controlar el navegador ("Control Chrome")
solo está disponible en macOS. En Windows no hay equivalente oficial, así que
este proyecto cubre ese hueco: levanta una instancia dedicada de Chrome, se
conecta a ella por CDP (Chrome DevTools Protocol) y expone 16 tools MCP para
que el modelo pueda navegar, leer páginas, rellenar formularios, hacer click y
depurar consola y red.

No es un fork ni una reimplementación del conector de Anthropic: es una
alternativa independiente, pensada específicamente para las particularidades de
Windows (descubrimiento de `chrome.exe`, perfil de usuario separado, y el
manejo de procesos huérfanos que se describe más abajo).

## Requisitos

- **Node.js 20 o superior**
- **Google Chrome** instalado (Chrome 136+ recomendado)
- **Windows** (el servidor usa `tasklist`/`taskkill` para la limpieza de
  procesos; el resto es multiplataforma, pero solo se prueba en Windows)

## Instalación y build

```sh
git clone https://github.com/<tu-usuario>/chrome-mcp.git
cd chrome-mcp
npm install
npm run build
```

Copia `.env.example` a `.env` y ajusta lo que necesites (todas las variables
tienen valores por defecto razonables):

```sh
copy .env.example .env
```

Para ejecutarlo directamente:

```sh
npm start
```

Para desarrollo con recarga automática:

```sh
npm run dev
```

Para inspeccionar las tools de forma interactiva con el MCP Inspector:

```sh
npm run inspect
```

## Configuración en Claude Desktop

Añade el servidor a `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "chrome-mcp": {
      "command": "node",
      "args": ["C:\\ruta\\a\\chrome-mcp\\dist\\index.js"]
    }
  }
}
```

Reinicia Claude Desktop después de editar el archivo.

### ⚠️ Dónde vive realmente `claude_desktop_config.json`

La documentación suele indicar `%APPDATA%\Claude`. Eso es correcto para la
instalación clásica de escritorio, pero **si instalaste Claude Desktop desde la
Microsoft Store (paquete MSIX), la app corre con virtualización de sistema de
archivos y el archivo real vive en otra ruta**:

```
%LOCALAPPDATA%\Packages\<nombre-del-paquete>\LocalCache\Roaming\Claude
```

Si editas el de `%APPDATA%\Claude` en una instalación MSIX, tus cambios
simplemente no se aplican y el servidor nunca aparece.

**La forma fiable de encontrar la ruta correcta:** abre Claude Desktop →
**Configuración** → **Developer** → botón **"Editar configuración"**. Eso abre
el archivo que la app está leyendo de verdad, sea cual sea la instalación.

## Tools disponibles

### Navegación

| Tool | Descripción |
| --- | --- |
| `navigate` | Navega la pestaña activa a una URL y espera el estado de carga indicado. |
| `go_back` | Vuelve a la página anterior del historial (botón Atrás). |
| `go_forward` | Avanza a la página siguiente del historial (botón Adelante). |
| `reload` | Recarga la página actual de la pestaña activa. |
| `list_tabs` | Lista las pestañas abiertas con su id, título y URL. |

### Extracción de contenido

| Tool | Descripción |
| --- | --- |
| `read_page` | Extrae el contenido de la página como markdown, texto plano o HTML crudo. |
| `screenshot` | Captura una imagen de la página completa, del viewport o de un elemento. |
| `query_elements` | Busca elementos por selector CSS y devuelve su texto y atributos clave. |

### Interacción

| Tool | Descripción |
| --- | --- |
| `click` | Hace click en el elemento que coincide con un selector CSS. |
| `fill` | Rellena un input, textarea o contenteditable (no envía el formulario). |
| `press_key` | Presiona una tecla o combinación sobre el foco actual (`Enter`, `Tab`, `Control+A`…). |
| `wait_for` | Espera hasta que un elemento sea visible o venza el timeout. |
| `scroll` | Desplaza la página arriba o abajo una cantidad de píxeles. |

### Depuración

| Tool | Descripción |
| --- | --- |
| `get_console_logs` | Devuelve los mensajes de consola capturados en la pestaña. |
| `get_network_requests` | Devuelve las peticiones de red capturadas (método, URL, status, tiempo). |
| `evaluate_js` | Ejecuta JavaScript arbitrario en la página. **Deshabilitada por defecto** — ver Seguridad. |

## Variables de entorno

Todas son opcionales y se documentan en `.env.example`.

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `TRANSPORT` | `stdio` | Transporte del servidor MCP: `stdio` o `http`. |
| `CHROME_PATH` | *(autodetección)* | Ruta al ejecutable de Chrome. Si se omite, el launcher intenta descubrirlo. |
| `CHROME_USER_DATA_DIR` | `C:\chrome-mcp-profile` | Perfil dedicado para la instancia automatizada (ver nota abajo). |
| `CDP_PORT` | `9222` | Puerto del Chrome DevTools Protocol (`--remote-debugging-port`). |
| `CDP_CONNECT_TIMEOUT_MS` | `10000` | Presupuesto total de reintentos de conexión CDP tras lanzar Chrome. |
| `ALLOWED_DOMAINS` | *(vacío = todos)* | Lista separada por comas de dominios a los que se permite navegar/interactuar. |
| `ALLOW_EVAL` | `false` | Habilita `evaluate_js`. Ver Seguridad antes de activarla. |
| `DEFAULT_TIMEOUT_MS` | `30000` | Timeout por defecto de las operaciones del navegador. |
| `MAX_CONTENT_CHARS` | `20000` | Máximo de caracteres devueltos por las tools de extracción antes de truncar. |

> Chrome 136+ se niega a exponer el DevTools Protocol sobre el perfil por
> defecto del usuario. Por eso el servidor siempre lanza Chrome con un
> `--user-data-dir` propio. No apuntes `CHROME_USER_DATA_DIR` a tu perfil
> personal de Chrome: no funcionará y, además, expondría tu sesión real a las
> tools.

## Seguridad

**`evaluate_js` está deshabilitada por defecto (`ALLOW_EVAL=false`) y la
recomendación es dejarla así.**

Esta tool ejecuta JavaScript arbitrario en el contexto de la página, lo que la
convierte en la única tool del servidor que puede:

- leer cookies, tokens de sesión y `localStorage` del sitio abierto,
- hacer peticiones a servidores externos desde dentro de la página (es decir,
  exfiltrar lo que acaba de leer),
- saltarse las restricciones que las demás tools aplican, porque no pasa por
  los mismos controles de selector y de dominio.

El resto de tools tienen una superficie mucho más acotada: leen contenido
renderizado o simulan acciones de usuario concretas.

Recomendaciones:

1. Mantén `ALLOW_EVAL=false` y actívala solo de forma puntual, para una tarea
   concreta, volviéndola a desactivar después.
2. **Deniega `evaluate_js` explícitamente en los permisos del conector dentro
   de Claude Desktop**, como segunda barrera. Así, aunque alguien active la
   variable de entorno por error, el cliente sigue bloqueando la llamada.
3. Usa `ALLOWED_DOMAINS` para restringir el servidor a los sitios que realmente
   necesitas automatizar.

## Nota conocida sobre Windows: procesos de Chrome huérfanos

Windows no tiene un `SIGTERM` real: cuando un cliente MCP cierra el servidor,
lo hace vía `TerminateProcess`, que mata el proceso de golpe y **no permite
ejecutar código de limpieza**. Como consecuencia, el Chrome que el servidor
había lanzado puede quedar vivo tras el cierre, y esos procesos se acumulan
entre reinicios.

El servidor mitiga esto con **reclaim-on-startup**: al arrancar, y antes de
conectarse, busca procesos de Chrome que apunten a su propio
`--user-data-dir` (los que él mismo lanzó) y los cierra. Nunca toca tu Chrome
personal, porque este usa un perfil distinto.

No es infalible — entre el cierre del servidor y el siguiente arranque el
proceso huérfano sigue existiendo, y si nunca vuelves a arrancar el servidor
nadie lo limpia — pero acota el problema a un único proceso residual en vez de
uno por sesión. Si necesitas limpiar a mano, cierra los `chrome.exe` cuyo
argumento `--user-data-dir` coincida con `CHROME_USER_DATA_DIR`.

## Cómo contribuir

Los PRs son bienvenidos. El flujo esperado:

1. Haz **fork** del repositorio.
2. Crea una **rama** descriptiva (`feat/nueva-tool`, `fix/timeout-navegacion`).
3. Abre un **PR contra `main`**, explicando qué cambia y cómo lo probaste.

Los detalles de entorno de desarrollo, smoke tests y convención de commits
están en [CONTRIBUTING.md](CONTRIBUTING.md).

## Licencia

MIT — ver [LICENSE](LICENSE).

## Author

Creado por [@THEGABOALE](https://github.com/THEGABOALE).

## Contributors

<a href="https://github.com/THEGABOALE/chrome-mcp/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=THEGABOALE/chrome-mcp" />
</a>
