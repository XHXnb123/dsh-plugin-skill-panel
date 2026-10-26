// 宿主半身路由自测：伪造 cordis ctx，把 /skill-panel/* 挂到临时 http 服务上真打一遍。
// 用临时 DSH_HOME，避免碰到真实的 ~/.dsh/AGENTS.md。
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "skill-panel-home-"));
// list 需要真实 home 才能扫到 skill；pins 的写入目录随后再切到临时 home
const realHome = process.env.DSH_HOME;
process.chdir("D:/mynote/xhxnb-note");

const { apply } = await import("./src/index.mjs");

const routes = new Map();
const logs = [];
const ctx = {
  get(name) {
    if (name === "webServer") {
      return {
        register(spec) {
          routes.set(spec.path, spec.handler);
        },
      };
    }
    return null;
  },
  logger: {
    info: (msg) => logs.push("info: " + msg),
    warn: (msg) => logs.push("warn: " + msg),
  },
  effect(factory) {
    factory();
  },
};

apply(ctx);
assert.ok(routes.size >= 5, "路由数量不对: " + routes.size);
console.log("注册路由:", [...routes.keys()].join(", "));

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const handler = routes.get(url.pathname);
  if (!handler) {
    res.writeHead(404).end("no route");
    return;
  }
  handler(req, res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function call(method, route, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + route, init);
  return { status: res.status, body: await res.json() };
}

// 1) 列表仍然正常
const list = await call("GET", "/skill-panel/list");
assert.equal(list.status, 200);
assert.ok(list.body.skills.length > 0, "没扫到 skill");
const names = list.body.skills.map((s) => s.name);
console.log("1) list OK:", list.body.skills.length, "个 skill");

// 从这里开始只碰临时 home
process.env.DSH_HOME = home;

// 2) 空 pins
const empty = await call("GET", "/skill-panel/pins");
assert.equal(empty.status, 200);
assert.deepEqual(empty.body.pins, []);
console.log("2) 空 pins OK");

// 3) 常驻两个
const target = names.slice(0, 2);
const pinned = await call("POST", "/skill-panel/pins", { pins: target });
assert.equal(pinned.status, 200);
assert.deepEqual(pinned.body.pins, target);
const agents = path.join(home, "AGENTS.md");
assert.ok(fs.existsSync(agents), "AGENTS.md 没写出来");
const text = fs.readFileSync(agents, "utf8");
assert.ok(text.includes("skill-panel:begin"), "缺受管区块");
for (const name of target) assert.ok(text.includes("`" + name + "`"), "缺条目 " + name);
console.log("3) 常驻 OK:", target.join(", "), "->", pinned.body.bytes, "bytes");

// 4) 未知名字被过滤
const mixed = await call("POST", "/skill-panel/pins", { pins: [target[0], "no-such-skill-xyz"] });
assert.deepEqual(mixed.body.pins, [target[0]]);
assert.deepEqual(mixed.body.unknown, ["no-such-skill-xyz"]);
console.log("4) 未知名字过滤 OK");

// 5) 取消全部 → 区块消失（文件只剩空内容时连文件一起删掉）
const cleared = await call("POST", "/skill-panel/pins", { pins: [] });
assert.deepEqual(cleared.body.pins, []);
const stillHasBlock = fs.existsSync(agents) && fs.readFileSync(agents, "utf8").includes("skill-panel:begin");
assert.equal(stillHasBlock, false, "区块没清掉");
console.log("5) 清空 OK（AGENTS.md 存在:", fs.existsSync(agents), "）");

// 6) 坏 JSON 给 400
const bad = await fetch(base + "/skill-panel/pins", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{not json",
});
assert.equal(bad.status, 400);
console.log("6) 坏 JSON 400 OK");

// 7) health 还在
const health = await call("GET", "/skill-panel/health");
assert.equal(health.status, 200);
console.log("7) health OK");

server.close();
fs.rmSync(home, { recursive: true, force: true });
console.log("\n全部通过");
