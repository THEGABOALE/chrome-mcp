# Contribuir a chrome-mcp

Gracias por el interés. Este documento cubre lo mínimo para levantar el entorno
y abrir un PR que se pueda revisar rápido.

## Entorno de desarrollo

Requisitos: Node.js 20+, Google Chrome y Windows.

```sh
git clone https://github.com/<tu-usuario>/chrome-mcp.git
cd chrome-mcp
npm install
copy .env.example .env
```

Comandos habituales:

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Ejecuta el servidor desde TypeScript con recarga automática (`tsx watch`). |
| `npm run build` | Compila a `dist/` con `tsc`. |
| `npm start` | Ejecuta el build compilado. |
| `npm run inspect` | Abre el MCP Inspector contra el servidor para probar tools a mano. |

Dos convenciones del proyecto que conviene tener presentes antes de tocar
código:

- **stdout es sagrado.** Con el transporte `stdio`, stdout está reservado para
  los mensajes JSON-RPC. Un `console.log` perdido corrompe el protocolo en
  silencio. Todo log va a stderr, vía `src/logger.ts`.
- **Rutas de Windows.** Construye rutas siempre con `path.join` / `path.resolve`,
  nunca concatenando strings con `+` ni con template literals.

## Smoke tests antes de un PR

Los smoke tests abren Chrome de verdad y navegan a `https://example.com`, así
que necesitan conexión a internet y que no haya otra instancia usando el
`CDP_PORT` configurado.

```sh
npm run smoke:browser    # lanza Chrome y comprueba la conexión CDP
npm run smoke:tools      # ejercita las tools directamente (navigate, read_page, ...)
npm run smoke:mcp        # ejercita el servidor por el protocolo MCP completo
```

Corre los tres antes de abrir un PR y menciona el resultado en la descripción.
Si tu cambio toca el ciclo de vida del proceso de Chrome, ejecútalos un par de
veces seguidas y comprueba con el Administrador de tareas que no queden
`chrome.exe` huérfanos apuntando a `CHROME_USER_DATA_DIR`.

## Convención de commits

El proyecto usa [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add wait_for_navigation tool
fix: prevent Chrome process leak on launcher stub exit
docs: document MSIX config path for Claude Desktop
chore: bump playwright-core to 1.49
```

Prefijos en uso: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.

No añadas trailers a los commits (`Co-Authored-By` ni similares).

## Flujo de PR

1. Fork del repositorio.
2. Rama descriptiva desde `main` (`feat/...`, `fix/...`).
3. PR contra `main`, explicando qué cambia, por qué, y qué smoke tests pasaste.

Los PRs pequeños y enfocados se revisan mucho más rápido que los que mezclan
varios cambios sin relación.
