# second-brain-mcp

A read-only [MCP](https://modelcontextprotocol.io) server for any Obsidian or plain-markdown vault, with the retrieval protocol enforced by the server instead of requested in prose.

Point it at a folder of markdown notes and every MCP client - Claude Code, Claude Desktop, Cursor, anything - can query that knowledge base through four governed tools. The server physically cannot write, cannot leave the vault directory, and cuts a session off after a hard budget of page reads.

## Why

Personal knowledge bases end up welded to one tool. The notes live in Obsidian; the AI assistant that could use them lives somewhere else, so you copy-paste. And when an assistant does get file access, "please read only what you need" is a politeness request, not a rule.

This server fixes both:

- **One connector, every app.** MCP is the USB-C of AI tools - write the vault connector once and any MCP client can use it.
- **The protocol is law, not a suggestion.** Index-first retrieval, a 5-page read budget, read-only access, and a path sandbox are enforced in code. The only operations that exist are the governed ones.

## Quick start (30 seconds, no vault needed)

The package ships with a small fictional demo vault, so you can try it before pointing it at real notes.

```bash
git clone https://github.com/nanthansr/second-brain-mcp
cd second-brain-mcp
npm install && npm run build
npm test        # 15-check smoke test over a real stdio connection
```

Add it to Claude Code:

```bash
claude mcp add second-brain -- node /abs/path/to/second-brain-mcp/dist/index.js
```

Or to Claude Desktop / Cursor (`mcpServers` config):

```json
{
  "mcpServers": {
    "second-brain": {
      "command": "node",
      "args": [
        "/abs/path/to/second-brain-mcp/dist/index.js",
        "/abs/path/to/your/vault"
      ]
    }
  }
}
```

The second argument is your vault. Omit it to serve the bundled demo vault.

## What the client gets

| Kind | Name | What it does | Budget |
|---|---|---|---|
| tool | `get_index` | Returns `index.md`, the one-line-per-page catalog. Call first. | free |
| tool | `search_notes` | Case-insensitive search, returns pages + line-numbered snippets | free |
| tool | `read_note` | Full content of one page by vault-relative path | counted |
| tool | `list_recent` | Pages modified in the last N days, newest first | free |
| resource | `vault://index` | The index as an MCP resource | free |
| prompt | `vault-retrieval` | The index-first protocol as a reusable prompt template | - |

The intended flow mirrors how a careful human uses a wiki: read the catalog, open the one or two pages that matter, answer with citations. Locating is cheap; reading is budgeted.

## Configuration

| Setting | How | Default |
|---|---|---|
| Vault path | first CLI argument, or `VAULT_PATH` env | bundled `sample-vault/` |
| Page read budget | `VAULT_READ_BUDGET` env | 5 per session |

## Security model

- **Read-only by construction.** No write, edit, or delete tool exists in the codebase.
- **Path sandbox.** Every path is resolved and must stay inside the vault root; traversal attempts (`../…`) are rejected. Only `.md` files are readable.
- **Hard page budget.** After N `read_note` calls (default 5) the server refuses further reads and tells the model to synthesize from what it has. Failed reads do not consume budget.
- **Size caps.** Notes truncate at 50KB; search results and recency lists are capped.
- **Dotfolders skipped.** `.obsidian`, `.git`, and other dotfolders are invisible.
- **Code is public, data is not.** The repo contains only server code and a fictional demo vault. Your real vault is whatever folder you mount at runtime; it never leaves your machine.

## Development

```bash
npm run build   # tsc -> dist/
npm test        # build + smoke test (spawns the server over stdio)
```

The smoke test verifies all four tools, the resource, the prompt, path-traversal rejection, and that the read budget actually refuses the N+1th read.

## Roadmap

- Remote variant (streamable HTTP) so the vault is reachable from mobile clients, with auth
- Optional per-folder scoping (serve only `wiki/`, hide `journal/`)

## License

MIT
