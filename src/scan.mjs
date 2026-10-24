// dsh-plugin-skill-panel — skill 发现与解析（纯 node，无第三方依赖）
// 扫描口径对齐 @deepseek-ai/dsh-skill-filesystem：<root>/<name>/SKILL.md 或 <root>/<name>.md，
// 只认一层深度，frontmatter 必需 name + description（name 必须 kebab-case）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FRONTMATTER_LIMIT = 64 * 1024;

/** 把 `~XXXX~` 片段还原为字符（DSH 会话目录名编码）。 */
function decodeTildes(text) {
  return text.replace(/~([0-9A-Fa-f]{4})~/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * 把 DSH 会话目录名还原成候选工作区路径。
 * `--D-notes-vault--` -> `D:\notes\vault`；解码后仍需存在性校验。
 */
export function decodeSessionDir(dirName) {
  const inner = dirName.replace(/^--/, "").replace(/--$/, "");
  if (inner === "") return undefined;
  const decoded = decodeTildes(inner);
  const drive = /^([A-Za-z])-(.*)$/.exec(decoded);
  if (!drive) return undefined;
  const rest = drive[2].split("-").filter((s) => s !== "");
  return `${drive[1].toUpperCase()}:\\${rest.join("\\")}`;
}

/** 解析 SKILL.md 的 YAML frontmatter（只取需要的标量/块标量，不引第三方 YAML）。 */
export function parseFrontmatter(text) {
  const result = {};
  const head = text.slice(0, FRONTMATTER_LIMIT);
  const open = /^\uFEFF?---\r?\n/.exec(head);
  if (!open) return result;
  const start = open[0].length;
  const closeIdx = head.slice(start).search(/^---[ \t]*\r?$/m);
  if (closeIdx === -1) return result;
  const block = head.slice(start, start + closeIdx);

  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      i += 1;
      continue;
    }
    const key = m[1];
    let value = m[2].trim();
    if (value === "" || value === "|" || value === ">" || /^[|>][+-]$/.test(value)) {
      // 块标量：收集后续缩进行
      const parts = [];
      i += 1;
      while (i < lines.length && (/^\s+\S/.test(lines[i]) || lines[i].trim() === "")) {
        parts.push(lines[i].replace(/^\s{1,}/, ""));
        i += 1;
      }
      const joined = /^>/.test(value) ? parts.join(" ").trim() : parts.join("\n").trim();
      result[key] = joined;
      continue;
    }
    // 去引号
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, "\n");
    }
    result[key] = value;
    i += 1;
  }
  return result;
}

/** 严格布尔：true/false、yes/no、on/off、1/0。非法返回 undefined 并由调用方判定。 */
function parseBool(value) {
  if (value === undefined) return undefined;
  const t = String(value).trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(t)) return true;
  if (["false", "no", "off", "0"].includes(t)) return false;
  return undefined;
}

/** 从 roots 扫描全部 skill；失败项进 errors，不抛。 */
export function scanRoots(roots) {
  const skills = [];
  const errors = [];
  for (const root of roots) {
    if (!root || !root.dir) continue;
    let entries;
    try {
      entries = fs.readdirSync(root.dir, { withFileTypes: true });
    } catch (error) {
      // 根不存在属于正常状态（用户没装该级 skill），不报错
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const base = path.join(root.dir, entry.name);
      let file;
      let kind;
      try {
        if (entry.isDirectory()) {
          file = path.join(base, "SKILL.md");
          kind = "bundle";
          if (!fs.existsSync(file)) continue;
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          file = base;
          kind = "flat";
        } else {
          continue;
        }
        const text = fs.readFileSync(file, "utf8");
        const fm = parseFrontmatter(text);
        const name = typeof fm.name === "string" ? fm.name.trim() : "";
        const description = typeof fm.description === "string" ? fm.description.trim() : "";
        if (!SKILL_NAME.test(name)) {
          errors.push({ root: root.dir, entry: entry.name, reason: `invalid name: ${name || "(empty)"}` });
          continue;
        }
        if (description === "") {
          errors.push({ root: root.dir, entry: entry.name, reason: "missing description" });
          continue;
        }
        const rawDisable = fm["disable-model-invocation"];
        const rawUser = fm["user-invocable"];
        const disableModel = parseBool(rawDisable);
        const userInvocable = parseBool(rawUser);
        if (rawDisable !== undefined && disableModel === undefined) {
          errors.push({ root: root.dir, entry: entry.name, reason: "invalid disable-model-invocation" });
          continue;
        }
        if (rawUser !== undefined && userInvocable === undefined) {
          errors.push({ root: root.dir, entry: entry.name, reason: "invalid user-invocable" });
          continue;
        }
        const stat = fs.statSync(file);
        skills.push({
          name,
          description,
          whenToUse: typeof fm.whenToUse === "string" ? fm.whenToUse.trim() : "",
          invocation: {
            modelInvocable: disableModel === true ? false : true,
            userInvocable: userInvocable === false ? false : true,
          },
          dir: kind === "bundle" ? base : path.dirname(base),
          path: file,
          kind,
          source: root.source,
          sourceLabel: root.sourceLabel,
          rank: root.rank,
          mtime: stat.mtimeMs,
          size: stat.size,
        });
      } catch (error) {
        errors.push({ root: root.dir, entry: entry.name, reason: String(error && error.message ? error.message : error) });
      }
    }
  }
  // 同层按 rank 优先，再按名称排序，并去重（首个胜出）
  skills.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const seen = new Set();
  const unique = [];
  for (const skill of skills.sort((a, b) => a.rank - b.rank || (a.name < b.name ? -1 : 1))) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    unique.push(skill);
  }
  unique.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { skills: unique, errors };
}

/** 组装全部候选根（项目级 / 用户级 / agents / 内置随包 / 自定义）。 */
export function buildRoots(options = {}) {
  const home = os.homedir();
  const dshHome = process.env.DSH_HOME || path.join(home, ".dsh");
  const roots = [];

  // rank 100：项目级 .dsh/skills —— 从最近会话目录反推工作区
  // 注意：home 自身不算"项目"，否则 ~/.dsh/skills 会被误标成项目级并抢掉 rank 400 的用户级
  for (const ws of discoverWorkspaces(dshHome)) {
    if (path.resolve(ws).toLowerCase() === path.resolve(home).toLowerCase()) continue;
    const dir = path.join(ws, ".dsh", "skills");
    if (fs.existsSync(dir)) roots.push({ source: "project", sourceLabel: `项目 · ${path.basename(ws)}`, dir, rank: 100 });
  }

  // rank 300：自定义
  for (const dir of options.customSkillDirs || []) {
    if (typeof dir === "string" && dir.trim() !== "") {
      roots.push({ source: "custom", sourceLabel: "自定义", dir: path.resolve(dir.trim()), rank: 300 });
    }
  }

  // rank 400：用户级 ~/.dsh/skills
  roots.push({ source: "user", sourceLabel: "用户", dir: path.join(dshHome, "skills"), rank: 400 });

  // rank 500：~/.agents/skills
  roots.push({ source: "agents", sourceLabel: "Agents", dir: path.join(home, ".agents", "skills"), rank: 500 });

  // rank 600：随包内置（filesystem 版 + asar 内 assets 版）
  for (const dir of bundledDirs()) {
    roots.push({ source: "bundled", sourceLabel: "内置", dir, rank: 600 });
  }

  // 去重（同一目录只扫一次）
  const seen = new Set();
  return roots.filter((root) => {
    const key = path.resolve(root.dir).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 最近会话反推的工作区路径（workspace.json 权威 + 会话目录兜底）。 */
export function discoverWorkspaces(dshHome) {
  const out = [];
  // 1) 权威来源：storages/workspace.json 的 tables.workspaces[].path，按 updatedAt 降序
  try {
    const raw = fs.readFileSync(path.join(dshHome, "storages", "workspace.json"), "utf8");
    const parsed = JSON.parse(raw);
    const table = parsed && parsed.tables && parsed.tables.workspaces;
    if (table && typeof table === "object") {
      const rows = Object.values(table)
        .filter((row) => row && typeof row.path === "string" && row.path.trim() !== "")
        .map((row) => ({ path: row.path, updatedAt: Date.parse(row.updatedAt || row.createdAt || 0) || 0 }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5);
      for (const row of rows) if (!out.includes(row.path)) out.push(row.path);
    }
  } catch { /* 首次启动或格式变化：降级 */ }

  // 2) 进程 cwd 本身（插件宿主 cwd 可能就是当前工作区；不扩散到祖先目录，避免把 home 当项目）
  if (process.cwd() && !out.includes(process.cwd())) out.push(process.cwd());

  // 3) 兜底：会话目录名反推（仅当路径真实存在时采纳）
  const sessionsDir = path.join(dshHome, "sessions");
  let entries = [];
  try {
    entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const full = path.join(sessionsDir, e.name);
        let mtime = 0;
        try { mtime = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
        return { name: e.name, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 5);
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    const ws = decodeSessionDir(entry.name);
    if (ws && !out.includes(ws)) out.push(ws);
  }
  return [...new Set(out)].filter((ws) => {
    try { return fs.statSync(ws).isDirectory(); } catch { return false; }
  });
}

/** 随包 skill 目录：安装目录下 resources/runtime/office-skills 与 asar 内 assets。 */
export function bundledDirs() {
  const dirs = [];
  const exeDir = path.dirname(process.execPath || process.cwd());
  const runtimeOffice = path.join(exeDir, "resources", "runtime", "office-skills");
  if (fs.existsSync(runtimeOffice)) dirs.push(runtimeOffice);
  // Electron 主进程可读 asar（普通 node 会抛错，已用 try/catch 屏蔽）
  const asar = path.join(exeDir, "resources", "app.asar");
  const assets = [
    path.join(asar, "dsh", "node_modules", "@deepseek-ai", "dsh-sandbox-windows-acl", "assets"),
    path.join(asar, "dsh", "node_modules", "@deepseek-ai", "dsh-skill-office", "assets"),
  ];
  for (const dir of assets) {
    try {
      if (fs.readdirSync(dir).length >= 0) dirs.push(dir);
    } catch { /* 普通 node 环境或 asar 不可读：跳过 */ }
  }
  return dirs;
}
