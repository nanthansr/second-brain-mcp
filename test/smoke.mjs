// Smoke test: spawns the built server over stdio against sample-vault and
// verifies every tool, the resource, the prompt, the path sandbox, and the
// hard page budget. Exit 0 = pass, exit 1 = fail.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name} ${detail}`);
  }
}

function firstText(result) {
  const block = (result.content ?? []).find((c) => c.type === "text");
  return block ? block.text : "";
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  stderr: "ignore",
});
const client = new Client({ name: "smoke-test", version: "0.0.0" });
await client.connect(transport);

// 1. All four tools are registered
const tools = await client.listTools();
const names = tools.tools.map((t) => t.name).sort();
check(
  "four tools registered",
  JSON.stringify(names) ===
    JSON.stringify(["get_index", "list_recent", "read_note", "search_notes"]),
  `got: ${names.join(",")}`
);

// 2. get_index returns the catalog
const index = await client.callTool({ name: "get_index", arguments: {} });
check("get_index returns catalog", firstText(index).includes("Catalog of every page"));

// 3. search_notes finds a known term with a path + snippet
const search = await client.callTool({
  name: "search_notes",
  arguments: { query: "spaced repetition" },
});
const searchText = firstText(search);
check(
  "search_notes finds known term",
  searchText.includes("wiki/concepts/spaced-repetition.md")
);

// 4. read_note returns a real page
const note = await client.callTool({
  name: "read_note",
  arguments: { path: "wiki/me.md" },
});
check("read_note reads a page", firstText(note).includes("Alex Rivera"));
check("read_note reports budget", firstText(note).includes("read 1/5"));

// 5. Path traversal is rejected
const escape = await client.callTool({
  name: "read_note",
  arguments: { path: "../package.json" },
});
check(
  "path traversal rejected",
  escape.isError === true && firstText(escape).includes("escapes the vault")
);

// 6. Non-markdown is rejected (in-vault path, wrong type)
const nonMd = await client.callTool({
  name: "read_note",
  arguments: { path: "wiki/me.txt" },
});
check("non-md rejected or missing", nonMd.isError === true);

// 7. The page budget is hard: 4 more reads succeed (5 total), the 6th refuses.
// Failed reads above must NOT have consumed budget.
for (const p of [
  "wiki/people/sam-okafor.md",
  "wiki/projects/kite-weather-app.md",
  "wiki/concepts/spaced-repetition.md",
  "index.md",
]) {
  const r = await client.callTool({ name: "read_note", arguments: { path: p } });
  check(`read within budget: ${p}`, r.isError !== true);
}
const overBudget = await client.callTool({
  name: "read_note",
  arguments: { path: "wiki/me.md" },
});
check(
  "6th read refused by budget",
  overBudget.isError === true && firstText(overBudget).includes("budget exhausted")
);

// 8. list_recent sees the sample vault (files were touched at install time)
const recent = await client.callTool({
  name: "list_recent",
  arguments: { days: 365 },
});
check("list_recent lists pages", firstText(recent).includes("index.md"));

// 9. Resource vault://index is readable
const resource = await client.readResource({ uri: "vault://index" });
check(
  "resource vault://index",
  (resource.contents?.[0]?.text ?? "").includes("Catalog of every page")
);

// 10. Prompt renders with the question embedded
const prompt = await client.getPrompt({
  name: "vault-retrieval",
  arguments: { question: "What is Alex working on?" },
});
const promptText = prompt.messages?.[0]?.content?.text ?? "";
check(
  "prompt vault-retrieval",
  promptText.includes("What is Alex working on?") &&
    promptText.includes("get_index first")
);

await client.close();

if (failures > 0) {
  console.log(`\nSMOKE FAIL (${failures} failing)`);
  process.exit(1);
}
console.log("\nSMOKE PASS");
