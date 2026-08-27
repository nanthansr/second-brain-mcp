#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_VAULT = path.resolve(HERE, "..", "sample-vault");

const vaultRoot = path.resolve(
  process.argv[2] ?? process.env.VAULT_PATH ?? DEFAULT_VAULT
);
const READ_BUDGET = Math.max(
  1,
  parseInt(process.env.VAULT_READ_BUDGET ?? "5", 10) || 5
);
const MAX_NOTE_BYTES = 50_000;
const MAX_SEARCH_FILES = 30;
const SNIPPETS_PER_FILE = 3;

// The whole point of this server: the retrieval protocol is enforced here,
// not requested in prose. Read-only by construction (no write tool exists),
// path-sandboxed, and a hard per-session page budget.
let pagesRead = 0;

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function err(s: string) {
  return { content: [{ type: "text" as const, text: s }], isError: true };
}

function resolveInVault(relPath: string): string | null {
  const abs = path.resolve(vaultRoot, relPath);
  if (abs !== vaultRoot && !abs.startsWith(vaultRoot + path.sep)) return null;
  return abs;
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // .obsidian, .git, ...
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listMarkdownFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function rel(abs: string): string {
  return path.relative(vaultRoot, abs).split(path.sep).join("/");
}

const server = new McpServer({ name: "second-brain-mcp", version: "0.1.0" });

server.registerTool(
  "get_index",
  {
    title: "Get the vault index",
    description:
      "Returns index.md, the catalog of every page in the vault (one line each). " +
      "ALWAYS call this first to locate relevant pages, then read only the 1-2 " +
      "pages that matter. Does not count against the page budget.",
  },
  async () => {
    const indexPath = path.join(vaultRoot, "index.md");
    try {
      const content = await fs.readFile(indexPath, "utf-8");
      return text(content);
    } catch {
      return err(
        "No index.md found at the vault root. Fall back to search_notes."
      );
    }
  }
);

server.registerTool(
  "search_notes",
  {
    title: "Search the vault",
    description:
      "Case-insensitive text search across every markdown page. Returns matching " +
      "pages with line-numbered snippets. Use when the index does not answer " +
      "'where does this live'. Does not count against the page budget.",
    inputSchema: {
      query: z.string().min(2).describe("Text to search for (literal, not regex)"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(MAX_SEARCH_FILES)
        .optional()
        .describe(`Max pages to return (default 10, cap ${MAX_SEARCH_FILES})`),
    },
  },
  async ({ query, max_results }) => {
    const cap = max_results ?? 10;
    const needle = query.toLowerCase();
    const files = await listMarkdownFiles(vaultRoot);
    const hits: string[] = [];
    for (const file of files) {
      if (hits.length >= cap) break;
      const content = await fs.readFile(file, "utf-8");
      if (!content.toLowerCase().includes(needle)) continue;
      const lines = content.split("\n");
      const snippets: string[] = [];
      for (let i = 0; i < lines.length && snippets.length < SNIPPETS_PER_FILE; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          snippets.push(`  ${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        }
      }
      hits.push(`${rel(file)}\n${snippets.join("\n")}`);
    }
    if (hits.length === 0) return text(`No pages match "${query}".`);
    return text(
      `${hits.length} page(s) match "${query}":\n\n${hits.join("\n\n")}\n\n` +
        `Read the most relevant page with read_note. Budget: ${READ_BUDGET - pagesRead} read(s) left.`
    );
  }
);

server.registerTool(
  "read_note",
  {
    title: "Read one page",
    description:
      "Returns the full content of one markdown page by vault-relative path " +
      "(e.g. wiki/people/sam-okafor.md). Counts against the hard page budget of " +
      `${READ_BUDGET} reads per session - locate pages via get_index or ` +
      "search_notes first, then read only what matters.",
    inputSchema: {
      path: z.string().describe("Vault-relative path to a .md file"),
    },
  },
  async ({ path: relPath }) => {
    if (pagesRead >= READ_BUDGET) {
      return err(
        `Page budget exhausted (${READ_BUDGET} reads this session). This is the ` +
          "vault's retrieval protocol: synthesize from what you have already read. " +
          "Restart the connection only if the task genuinely needs a fresh budget."
      );
    }
    const abs = resolveInVault(relPath);
    if (abs === null) {
      return err(`Path escapes the vault: "${relPath}". Rejected.`);
    }
    if (!abs.endsWith(".md")) {
      return err("Only .md pages can be read.");
    }
    let content: string;
    try {
      content = await fs.readFile(abs, "utf-8");
    } catch {
      return err(`No page at "${relPath}". Check the path via get_index.`);
    }
    pagesRead++;
    let body = content;
    if (Buffer.byteLength(body, "utf-8") > MAX_NOTE_BYTES) {
      body = body.slice(0, MAX_NOTE_BYTES) + "\n\n[truncated at 50KB]";
    }
    return text(
      `# ${rel(abs)} (read ${pagesRead}/${READ_BUDGET})\n\n${body}`
    );
  }
);

server.registerTool(
  "list_recent",
  {
    title: "List recently updated pages",
    description:
      "Lists pages modified in the last N days (default 7), newest first. " +
      "Good for 'what changed lately'. Does not count against the page budget.",
    inputSchema: {
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("Look-back window in days (default 7)"),
    },
  },
  async ({ days }) => {
    const windowMs = (days ?? 7) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - windowMs;
    const files = await listMarkdownFiles(vaultRoot);
    const recent: { p: string; mtime: number }[] = [];
    for (const file of files) {
      const stat = await fs.stat(file);
      if (stat.mtimeMs >= cutoff) recent.push({ p: rel(file), mtime: stat.mtimeMs });
    }
    recent.sort((a, b) => b.mtime - a.mtime);
    const capped = recent.slice(0, 50);
    if (capped.length === 0) {
      return text(`No pages modified in the last ${days ?? 7} day(s).`);
    }
    const rows = capped.map(
      (r) => `${new Date(r.mtime).toISOString().slice(0, 10)}  ${r.p}`
    );
    return text(rows.join("\n"));
  }
);

server.registerResource(
  "vault-index",
  "vault://index",
  {
    title: "Vault index",
    description: "The vault's index.md - a catalog of every page, one line each.",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const content = await fs.readFile(path.join(vaultRoot, "index.md"), "utf-8");
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: content }] };
  }
);

server.registerPrompt(
  "vault-retrieval",
  {
    title: "Vault retrieval protocol",
    description:
      "The index-first retrieval protocol for answering a question from the vault.",
    argsSchema: {
      question: z.string().describe("The question to answer from the vault"),
    },
  },
  ({ question }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text:
            `Answer this question from the knowledge vault: ${question}\n\n` +
            "Follow the retrieval protocol strictly:\n" +
            "1. Call get_index first and locate the 1-2 most relevant pages.\n" +
            "2. Read only those pages with read_note. The server enforces a hard " +
            `budget of ${READ_BUDGET} page reads - spend them deliberately.\n` +
            "3. Use search_notes only when the index does not tell you where " +
            "something lives.\n" +
            "4. Answer with citations: name the page(s) each claim came from.\n" +
            "5. If the vault does not contain the answer, say so - never invent " +
            "vault content.",
        },
      },
    ],
  })
);

async function main() {
  try {
    const stat = await fs.stat(vaultRoot);
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    console.error(`second-brain-mcp: vault path is not a directory: ${vaultRoot}`);
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `second-brain-mcp: serving ${vaultRoot} read-only, page budget ${READ_BUDGET}`
  );
}

main();
