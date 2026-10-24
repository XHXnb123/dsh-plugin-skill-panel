// 冒烟测试：用 mock ctx 调 apply()，验证 4 条路由注册成功、list 输出分组正确、read 能读正文
import { apply, name } from "./src/index.mjs";

const registered = [];
const logs = [];
const ctx = {
  get: (key) => (key === "webServer" ? { register: (route) => registered.push(route) } : undefined),
  effect: (fn) => fn(),
  logger: { info: (m) => logs.push("info: " + m), warn: (m) => logs.push("warn: " + m) },
};

apply(ctx);

function call(route, url) {
  const req = { url };
  let status = 0;
  let body = "";
  const res = {
    writeHead(s) { status = s; },
    end(chunk) { body = String(chunk || ""); },
  };
  route.handler(req, res);
  return { status, body };
}

console.log("plugin name:", name);
console.log("routes:", registered.map((r) => r.path).join(", "));
console.log("logs:", logs.join(" | "));

const list = registered.find((r) => r.path === "/skill-panel/list");
const res1 = call(list, "/skill-panel/list");
const data = JSON.parse(res1.body);
console.log("list status:", res1.status, "ok:", data.ok, "count:", data.count);
const bySource = {};
for (const s of data.skills) bySource[s.source] = (bySource[s.source] || 0) + 1;
console.log("by source:", JSON.stringify(bySource));
console.log("roots:", data.roots.map((r) => `${r.source}(${r.count})@${r.dir}`).join(" | "));
console.log("errors:", data.errors.length);

const userSkills = data.skills.filter((s) => s.source === "user").map((s) => s.name);
const projectSkills = data.skills.filter((s) => s.source === "project").map((s) => s.name);
const bundled = data.skills.filter((s) => s.source === "bundled").map((s) => s.name);
console.log("user:", userSkills.join(","));
console.log("project:", projectSkills.join(","));
console.log("bundled:", bundled.join(","));

const read = registered.find((r) => r.path === "/skill-panel/read");
const res2 = call(read, "/skill-panel/read?name=domain-modeling");
const body2 = JSON.parse(res2.body);
console.log("read status:", res2.status, "ok:", body2.ok, "chars:", (body2.content || "").length);
const res3 = call(read, "/skill-panel/read?name=..%2F..%2Fetc%2Fpasswd");
console.log("read traversal status:", res3.status, JSON.parse(res3.body).error.message);

const health = registered.find((r) => r.path === "/skill-panel/health");
console.log("health:", call(health, "/skill-panel/health").body);
