# Design notes

The reasoning behind the choices in this server. Useful if you're building your own MCP server or reviewing this one.

## Architecture at a glance

```
MCP client (Claude Code / Claude Desktop / Cursor)
    | spawns child process, JSON-RPC over stdin/stdout
    v
second-brain-mcp (src/index.ts, ~280 lines)
    | fs reads only, sandboxed + budgeted
    v
your vault (a folder of markdown files)
```

One file, no framework, no state outside the process. The interesting decisions are below.

## Why stdio, and the one rule it imposes

The stdio transport means the client launches this server as a child process and speaks JSON-RPC through stdin/stdout. That has one hard consequence: **stdout belongs to the protocol**. A single `console.log` corrupts the message stream and the server breaks in confusing ways. Every log line in this codebase goes to `console.error` - stderr is free for humans.

A remote variant would use the streamable HTTP transport instead (the server becomes a URL). See the budget section for what that would change.

## The three primitives, and who controls each

MCP has three ways to expose things, distinguished by who pulls the trigger:

- **Tools** are model-controlled - the model decides to call `read_note`.
- **Resources** are app-controlled - the client application decides to attach `vault://index` as context.
- **Prompts** are user-controlled - a human picks `vault-retrieval` from a menu.

This server ships all three on purpose: same underlying data, three access patterns.

## Tool schemas are prompts in disguise

Inputs are declared as zod schemas; the SDK converts them to JSON Schema and advertises them to the model together with each tool's `description`. The model reads those descriptions to decide when and how to call - which means descriptions are steering, not documentation. `read_note`'s description says "counts against the hard page budget... read only what matters" precisely so the model economizes. Writing tool descriptions is prompt engineering.

## Security decisions

**Read-only by construction.** There is no write, edit, or delete tool anywhere in the codebase. Absent capability is stronger than gated capability: a permission check can be argued with, a tool that does not exist cannot.

**Canonicalize, then compare.** The path sandbox resolves the caller's path first (`path.resolve`), applying every `..` and quirk, and only then checks the final destination is inside the vault root (`resolveInVault` in `src/index.ts`). Inspecting the raw string for suspicious patterns is the classic bug: attackers only need one encoding you forgot. After canonicalization there is nothing left to hide behind.

**The page budget is per-session because of the transport.** `pagesRead` is a single variable in the process, and stdio gives every client connection its own process - so per-session state falls out for free. On a remote HTTP server many sessions share one process, and this would need to become a counter keyed by session id. Failed reads (bad path, wrong type) deliberately do not consume budget.

**Errors are steering, not failure.** When the budget runs out, the server returns `isError: true` with instructions: "synthesize from what you have already read." The model sees that as a tool result and adapts. A crash teaches the model nothing.

**Size caps everywhere.** Notes truncate at 50KB, search results and recency lists are capped, dotfolders (`.obsidian`, `.git`) are invisible.

## Why the test is an integration test

`test/smoke.mjs` mocks nothing. It uses the SDK's own client to spawn the real compiled server and speak real protocol over stdio - so it exercises the SDK wiring, the transport, the schemas, and the handlers in one pass. One detail worth stealing: it verifies that *failed* reads do not consume budget, the off-by-one a mocked unit test would never catch.
