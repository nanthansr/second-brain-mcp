# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-08-27

### Added

- Initial release: read-only MCP server for Obsidian/markdown vaults over stdio.
- Tools: `get_index`, `search_notes`, `read_note`, `list_recent`.
- Resource: `vault://index`. Prompt: `vault-retrieval`.
- Enforced retrieval protocol: path sandbox (canonicalize-then-compare), hard
  per-session page budget (default 5 reads, configurable via `VAULT_READ_BUDGET`),
  50KB note truncation, capped search results, dotfolders hidden.
- Bundled fictional `sample-vault/` so the server is testable without real notes.
- 15-check integration smoke test over a real stdio connection (`npm test`).
- CI on Linux and Windows, Node 20 and 22.
- Published to npm as `@nanthansr/second-brain-mcp` (the unscoped name is blocked by
  npm's similarity rule against an existing `secondbrain-mcp`).
