# chrome-mcp

An MCP (Model Context Protocol) server that controls a Chrome browser on
Windows via the DevTools Protocol, exposing navigation, content extraction,
interaction, and debugging tools to MCP clients.

## Install

```sh
npm install
```

## Configure

Copy `.env.example` to `.env` and adjust as needed. See that file for a
description of each variable.

Chrome 136+ blocks DevTools Protocol connections to the default user profile,
so this server launches Chrome with a dedicated `--user-data-dir` (see
`CHROME_USER_DATA_DIR`).

## Run

```sh
npm run build
npm start
```

For local development with automatic reload:

```sh
npm run dev
```

To inspect the server's tools interactively via the MCP Inspector:

```sh
npm run inspect
```
