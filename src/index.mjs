// dsh-plugin-skill-panel — 宿主半身：发现本机全部 skill，供 GUI 浮卡消费
// 契约参照 dsh-plugin-vault-memory（已真源码校准）：
//   export const name / apply(ctx)；webServer.register({ kind:"exact", path, handler }) 提供 JSON 路由。
// 数据来源见 scan.mjs：项目 .dsh/skills、用户 ~/.dsh/skills、~/.agents/skills、随包内置 office skills。

import fs from "node:fs";
import { readState, writePins } from "./pins.mjs";
import { buildRoots, scanRoots } from "./scan.mjs";

export const name = "dsh-plugin-skill-panel";

const CACHE_MS = 2000;
const MAX_READ_BYTES = 512 * 1024;

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`请求体过大（上限 ${limit} 字节）`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function fail(res, error) {
  json(res, 500, { ok: false, error: { message: String(error && error.message ? error.message : error) } });
}

export function apply(ctx) {
  const webServer = ctx.get("webServer");
  if (!webServer || typeof webServer.register !== "function") {
    ctx.logger.warn("skill-panel: webServer 服务不可用，GUI 路由未注册");
    return;
  }

  const state = { cache: null, at: 0 };

  function snapshot(force) {
    const now = Date.now();
    if (!force && state.cache && now - state.at < CACHE_MS) return state.cache;
    const roots = buildRoots();
    const scanned = scanRoots(roots);
    state.cache = {
      skills: scanned.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        whenToUse: skill.whenToUse || "",
        source: skill.source,
        sourceLabel: skill.sourceLabel,
        path: skill.path,
        dir: skill.dir,
        kind: skill.kind,
        size: skill.size,
        invocation: skill.invocation,
      })),
      errors: scanned.errors,
      count: scanned.skills.length,
      roots: roots
        .filter((root) => {
          try {
            return fs.statSync(root.dir).isDirectory();
          } catch {
            return false;
          }
        })
        .map((root) => {
          const prefix = root.dir.toLowerCase();
          return {
            source: root.source,
            sourceLabel: root.sourceLabel,
            dir: root.dir,
            count: scanned.skills.filter((skill) => String(skill.path).toLowerCase().startsWith(prefix)).length,
          };
        }),
      scannedAt: new Date().toISOString(),
    };
    state.at = now;
    return state.cache;
  }

  const routes = [
    {
      path: "/skill-panel/list",
      handler: (_req, res) => {
        try {
          json(res, 200, { ok: true, ...snapshot(false) });
        } catch (error) {
          json(res, 500, { ok: false, error: { message: String(error && error.message ? error.message : error) } });
        }
      },
    },
    {
      path: "/skill-panel/refresh",
      handler: (_req, res) => {
        try {
          json(res, 200, { ok: true, ...snapshot(true) });
        } catch (error) {
          json(res, 500, { ok: false, error: { message: String(error && error.message ? error.message : error) } });
        }
      },
    },
    {
      // 只允许读取当前目录里真实存在的 skill 正文，路径必须命中扫描结果（防任意文件读取）
      path: "/skill-panel/read",
      handler: (req, res) => {
        const url = new URL(req.url || "/", "http://localhost");
        const name = url.searchParams.get("name") || "";
        const snap = snapshot(false);
        const hit = snap.skills.find((skill) => skill.name === name);
        if (!hit) return json(res, 404, { ok: false, error: { message: `找不到 skill: ${name}` } });
        try {
          const stat = fs.statSync(hit.path);
          if (stat.size > MAX_READ_BYTES) {
            return json(res, 413, { ok: false, error: { message: `skill 正文过大: ${stat.size} 字节` } });
          }
          const content = fs.readFileSync(hit.path, "utf8");
          json(res, 200, { ok: true, name: hit.name, description: hit.description, path: hit.path, size: stat.size, content });
        } catch (error) {
          json(res, 500, { ok: false, error: { message: String(error && error.message ? error.message : error) } });
        }
      },
    },
    {
      // 常驻技能：写入 ~/.dsh/AGENTS.md 的受管区块，新会话第一次请求即生效
      path: "/skill-panel/pins",
      handler: (req, res) => {
        if ((req.method || "GET").toUpperCase() !== "POST") {
          try {
            json(res, 200, { ok: true, ...readState() });
          } catch (error) {
            fail(res, error);
          }
          return;
        }
        readBody(req, 128 * 1024)
          .then((text) => {
            let body = {};
            try {
              body = JSON.parse(text || "{}");
            } catch {
              json(res, 400, { ok: false, error: { message: "请求体不是合法 JSON" } });
              return;
            }
            const snap = snapshot(false);
            const known = new Set(snap.skills.map((skill) => skill.name));
            const requested = Array.isArray(body.pins) ? body.pins : [];
            const clean = [];
            const unknown = [];
            for (const item of requested) {
              const name = String(item || "").trim();
              if (!name) continue;
              if (!known.has(name)) {
                unknown.push(name);
                continue;
              }
              if (!clean.includes(name)) clean.push(name);
            }
            const written = writePins(clean, snap.skills);
            json(res, 200, { ok: true, ...written, unknown });
          })
          .catch((error) => fail(res, error));
      },
    },
    {
      path: "/skill-panel/health",
      handler: (_req, res) => {
        const snap = state.cache;
        json(res, 200, {
          ok: true,
          count: snap ? snap.skills.length : null,
          roots: snap ? snap.roots.length : null,
          scannedAt: snap ? snap.scannedAt : null,
        });
      },
    },
  ];

  for (const route of routes) {
    try {
      webServer.register({ kind: "exact", path: route.path, handler: route.handler });
    } catch (error) {
      ctx.logger.warn(`skill-panel: 路由 ${route.path} 注册失败：${String(error && error.message ? error.message : error)}`);
    }
  }
  ctx.logger.info("skill-panel: 已注册 /skill-panel/* 路由");

  ctx.effect(() => () => {
    state.cache = null;
  }, "skill-panel cache cleanup");

}

