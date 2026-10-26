// 常驻技能自测：在临时 DSH_HOME 里验证写入、合并、清空三条路径。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "skill-panel-pins-"));
process.env.DSH_HOME = home;

const { readPins, writePins, readState, agentsFile } = await import("./src/pins.mjs");

const skills = [
  { name: "natural-chinese", description: "让中文读起来像人写的。", whenToUse: "任何中文写作" },
  { name: "humanizer-yu", description: "去除 AI 生成痕迹。", whenToUse: "" },
];

// 1) 写入
let out = writePins(["natural-chinese", "humanizer-yu"], skills);
assert.equal(out.pins.length, 2);
let text = fs.readFileSync(agentsFile(), "utf8");
assert.ok(text.includes("<!-- skill-panel:begin -->"), "缺少 begin 标记");
assert.ok(text.includes("`natural-chinese`：让中文读起来像人写的。"), "缺少条目描述");
assert.ok(text.includes("何时用：任何中文写作"), "缺少何时用");
assert.deepEqual(readPins(), ["natural-chinese", "humanizer-yu"]);
console.log("1) 写入 OK:", out.bytes, "bytes");

// 2) 用户自己的内容要保留，区块要被替换而不是追加
fs.writeFileSync(agentsFile(), "# 我自己的全局指令\n\n永远用简体中文回答。\n\n" + text, "utf8");
out = writePins(["humanizer-yu"], skills);
text = fs.readFileSync(agentsFile(), "utf8");
assert.ok(text.startsWith("# 我自己的全局指令"), "原有内容被冲掉");
assert.ok(text.includes("永远用简体中文回答。"), "原有正文丢了");
assert.equal(text.split("<!-- skill-panel:begin -->").length - 1, 1, "区块重复了");
assert.ok(!text.includes("`natural-chinese`"), "被移除的条目还在");
console.log("2) 合并 OK");

// 3) 清空 → 区块整块消失，但用户内容保留
out = writePins([], skills);
text = fs.readFileSync(agentsFile(), "utf8");
assert.ok(!text.includes("skill-panel:begin"), "空列表没清掉区块");
assert.ok(text.includes("永远用简体中文回答。"), "清空时误删用户内容");
assert.deepEqual(readPins(), []);
console.log("3) 清空 OK");

// 4) 从未写过 AGENTS.md 的文件里清空 → 文件被删掉，不留空文件
fs.rmSync(agentsFile());
writePins(["natural-chinese"], skills);
writePins([], skills);
assert.equal(fs.existsSync(agentsFile()), false, "空文件没删掉");
console.log("4) 删空文件 OK");

// 5) 去重 + 忽略未知名字（未知名字由路由层过滤，这里只验证去重）
out = writePins(["natural-chinese", "natural-chinese"], skills);
assert.deepEqual(out.pins, ["natural-chinese"]);
console.log("5) 去重 OK");

const state = readState();
console.log("state:", JSON.stringify(state));

fs.rmSync(home, { recursive: true, force: true });
console.log("\n全部通过");
