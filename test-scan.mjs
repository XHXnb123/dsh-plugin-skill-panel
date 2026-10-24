import fs from "node:fs";
import { buildRoots, scanRoots, discoverWorkspaces } from "./src/scan.mjs";

const roots = buildRoots();
const result = scanRoots(roots);
const lines = [];
lines.push("=== ROOTS ===");
for (const r of roots) lines.push(`${r.source}\t${r.sourceLabel}\t${r.dir}`);
lines.push("");
lines.push("=== WORKSPACES ===");
lines.push(JSON.stringify(discoverWorkspaces(process.env.USERPROFILE + "\\.dsh")));
lines.push("");
lines.push(`=== SKILLS (${result.skills.length}) ===`);
for (const s of result.skills) {
  lines.push(`${s.name}\t[${s.source}] ${s.sourceLabel}\t${s.description.slice(0, 70).replace(/\s+/g, " ")}`);
}
lines.push("");
lines.push(`=== ERRORS (${result.errors.length}) ===`);
for (const e of result.errors) lines.push(`${e.root}\t${e.entry}\t${e.reason}`);
fs.writeFileSync("out.txt", lines.join("\n"), "utf8");
console.log("done", result.skills.length, "skills");

