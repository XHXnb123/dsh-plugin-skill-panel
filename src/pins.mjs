// 常驻技能：把选中的 skill 写进 ~/.dsh/AGENTS.md 的受管区块。
// DSH 的 dsh-agent-instructions 会在每个会话的第一次请求把用户全局 AGENTS.md
// 作为工作区指引注入（65KB 预算），因此写这里的技能不需要用户每次点名，
// 模型自己会在相关任务里先调用 skill 工具加载它。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BEGIN = "<!-- skill-panel:begin -->";
const END = "<!-- skill-panel:end -->";
const MAX_DESC = 180;

export function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  return path.join(os.homedir(), ".dsh");
}

export function stateFile() {
  return path.join(dshHome(), "skill-panel", "pins.json");
}

export function agentsFile() {
  return path.join(dshHome(), "AGENTS.md");
}

export function readPins() {
  try {
    const data = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    const list = Array.isArray(data && data.pins) ? data.pins : [];
    return list
      .map((name) => String(name || "").trim())
      .filter((name, index, arr) => name && arr.indexOf(name) === index);
  } catch {
    return [];
  }
}

function squeeze(text, max) {
  const one = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!one) return "";
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

function renderBlock(skills, pins) {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const lines = [
    BEGIN,
    "## 常驻技能（由 dsh-plugin-skill-panel 维护，勿手动编辑本区块）",
    "",
    "下列技能默认启用：遇到相关任务时先调用 `skill` 工具加载对应技能，再按它的指引执行，不需要等用户点名。",
    "",
  ];
  for (const name of pins) {
    const skill = byName.get(name);
    const desc = skill ? squeeze(skill.description, MAX_DESC) : "";
    const when = skill ? squeeze(skill.whenToUse, MAX_DESC) : "";
    let line = "- `" + name + "`";
    if (desc) line += "：" + desc;
    if (when) line += "（何时用：" + when + "）";
    lines.push(line);
  }
  lines.push(END);
  return lines.join("\n");
}

function mergeBlock(existing, block) {
  const text = existing || "";
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start >= 0 && end > start) {
    const before = text.slice(0, start).replace(/\s+$/, "");
    const after = text.slice(end + END.length).replace(/^\s+/, "");
    const parts = [before, block, after].filter((part) => part && part.trim());
    return parts.length ? parts.join("\n\n") + "\n" : "";
  }
  if (!block) return text;
  const head = text.replace(/\s+$/, "");
  return (head ? head + "\n\n" : "") + block + "\n";
}

/** 读当前状态：pins + AGENTS.md 里的实际字节数。 */
export function readState() {
  const pins = readPins();
  let bytes = 0;
  let exists = false;
  try {
    const raw = fs.readFileSync(agentsFile(), "utf8");
    bytes = Buffer.byteLength(raw, "utf8");
    exists = true;
  } catch {
    exists = false;
  }
  return { pins, file: agentsFile(), bytes, exists };
}

/** 写 pins.json 并重建 AGENTS.md 的受管区块；pins 为空时整块移除。 */
export function writePins(pins, skills) {
  const clean = [];
  for (const name of pins || []) {
    const value = String(name || "").trim();
    if (value && !clean.includes(value)) clean.push(value);
  }

  const dir = path.dirname(stateFile());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    stateFile(),
    JSON.stringify({ pins: clean, updatedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8"
  );

  let existing = "";
  try {
    existing = fs.readFileSync(agentsFile(), "utf8");
  } catch {
    existing = "";
  }
  const block = clean.length ? renderBlock(skills, clean) : "";
  const next = mergeBlock(existing, block);

  if (next.trim()) {
    fs.writeFileSync(agentsFile(), next, "utf8");
  } else {
    try {
      fs.unlinkSync(agentsFile());
    } catch {
      /* 文件本来就不存在 */
    }
  }

  return { pins: clean, file: agentsFile(), bytes: Buffer.byteLength(next, "utf8") };
}
