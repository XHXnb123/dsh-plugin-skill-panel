// dsh-plugin-skill-panel — 浏览器半身：右下角 🧩 Skills 胶囊 + 星图面板（skill 节点画成三簇弧线星座）
// 契约对齐官方模板 @deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/templates/decoration：
//   window.__ModuleLoader__.load({ id: <包名>, factory })；factory 返回 { inject: ['slots'], apply(ctx) }；
//   apply 内 ctx.slots.inject(slotName, () => ctx.slots.register({ name, id, order }, Component))。
// 渲染一律走 React 组件（不 append document.body），数据走宿主 webServer 的 /skill-panel/* 路由。

window.__ModuleLoader__.load({
  id: "dsh-plugin-skill-panel",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useRef, useMemo } = React;

    const LIST_PATH = "/skill-panel/list";
    const REFRESH_PATH = "/skill-panel/refresh";
    const READ_PATH = "/skill-panel/read";

    // 星图配色：金 / 象牙 / 青 —— 三簇各自一色，和面板的深墨蓝底拉开层次
    const SOURCE_COLORS = {
      project: "#C9A227",
      user: "#E8E2D0",
      agents: "#9FB6D4",
      custom: "#B48EF0",
      bundled: "#6FA8A0",
    };
    const SOURCE_LABELS = {
      project: "PROJECT",
      user: "USER",
      agents: "AGENTS",
      custom: "CUSTOM",
      bundled: "BUNDLED",
    };
    const SOURCE_CN = {
      project: "项目",
      user: "用户",
      agents: "Agents",
      custom: "自定义",
      bundled: "内置",
    };

    // 星盘几何：设计稿 430×500，靠 viewBox 缩放到面板宽度
    const MAP_W = 430;
    const MAP_H = 500;
    const MAP_CX = 215;
    const MAP_CY = 252;
    const RAD = Math.PI / 180;
    // 功能分类：盘面按用途分六段弧，弧段本身就是分类标识
    const CATEGORIES = [
      { key: "writing", cn: "写作与润色", short: "写作", en: "WRITING", color: "#E2B65C" },
      { key: "design", cn: "设计与视觉", short: "设计", en: "DESIGN", color: "#C78BF0" },
      { key: "office", cn: "文档与办公", short: "办公", en: "OFFICE", color: "#63A9D6" },
      { key: "engineering", cn: "工程与规划", short: "工程", en: "ENGINEER", color: "#79CCA8" },
      { key: "ops", cn: "运营与内容", short: "运营", en: "OPS", color: "#E98A6E" },
      { key: "diagnose", cn: "诊断与维护", short: "诊断", en: "DIAGNOSE", color: "#B9C0CC" },
    ];
    const CATEGORY_BY_NAME = {
      "humanizer-yu": "writing",
      "natural-chinese": "writing",
      "paper-humanizer": "writing",
      "huashu-design": "design",
      "huashu-art-motion": "design",
      "diagnose-windows-sandbox-acl": "diagnose",
      "tencent-channel-community": "ops",
      "wechat-oa-style": "ops",
      "domain-modeling": "engineering",
      "grill-me": "engineering",
      "grill-with-docs": "engineering",
      "grilling": "engineering",
    };

    /** 名字优先、关键字兜底；认不出来的一律归到「工程与规划」。 */
    function classify(skill) {
      const name = String((skill && skill.name) || "").toLowerCase();
      if (CATEGORY_BY_NAME[name]) return CATEGORY_BY_NAME[name];
      if (/^office/.test(name)) return "office";
      const text = name + " " + String((skill && skill.description) || "").toLowerCase();
      if (/(docx|xlsx|pptx|spreadsheet|presentation|word document|excel|powerpoint)/.test(text)) return "office";
      if (/(写|润色|文案|文章|humaniz|writing|polish|academic)/.test(text)) return "writing";
      if (/(设计|视觉|动画|design|visual|animation)/.test(text)) return "design";
      if (/(频道|公众号|运营|社区|community|wechat)/.test(text)) return "ops";
      if (/(诊断|调试|diagnos|debug|repair)/.test(text)) return "diagnose";
      return "engineering";
    }

    // 分类环：一圈六段弧，段间留缝，段的长度按该分类的 skill 数量分
    const RING_R = 188;
    const RING_GAP = 9;
    const MIN_SPAN = 24;

    function buildArcs(groups) {
      const n = groups.length || 1;
      const avail = 360 - RING_GAP * n;
      const fixed = groups.map((g) => (g.items.length === 1 ? MIN_SPAN : 0));
      const fixedSum = fixed.reduce((a, b) => a + b, 0);
      const restCount = groups.reduce((s, g, i) => s + (fixed[i] ? 0 : g.items.length), 0) || 1;
      const restAvail = Math.max(0, avail - fixedSum);
      let cursor = -90;
      const arcs = {};
      groups.forEach((g, i) => {
        const span = fixed[i] || (restAvail * g.items.length) / restCount;
        arcs[g.key] = { from: cursor, to: cursor + span, r: RING_R, span };
        cursor += span + RING_GAP;
      });
      return arcs;
    }

    function polar(r, deg) {
      return [MAP_CX + Math.cos(deg * RAD) * r, MAP_CY + Math.sin(deg * RAD) * r];
    }

    // 旧版宿主会把用户级 ~/.dsh/skills 误标成 project（它与某 workspace 同路径同 rank），
    // 这里按 path 兜底纠正一次：改宿主代码要重启应用，改客户端只要刷页面。
    function resolveSource(skill) {
      const raw = skill && typeof skill.source === "string" ? skill.source : "custom";
      const p = String((skill && skill.path) || "").split("/").join("\\").toLowerCase();
      if (p.indexOf("app.asar") >= 0 || p.indexOf("\\resources\\") >= 0) return "bundled";
      if (/^[a-z]:\\users\\[^\\]+\\.dsh\\skills\\/.test(p)) return "user";
      return raw;
    }

    const CSS = `
.skp-root { position: fixed; right: 20px; bottom: 200px; z-index: 2147483600; display: inline-flex; align-items: center; font-size: 12px; pointer-events: auto; }
.skp-capsule { cursor: pointer; border: 1px solid rgba(201,162,39,.45); background: rgba(12,18,30,.72); color: #EDE6D4; border-radius: 999px; padding: 3px 10px; font: inherit; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; }
.skp-capsule:hover { border-color: rgba(201,162,39,.85); background: rgba(20,30,48,.9); }
.skp-badge { opacity: .7; font-variant-numeric: tabular-nums; }

.skp-legend { display: flex; gap: 4px; padding: 0 12px 8px; overflow-x: auto; scrollbar-width: none; flex-wrap: nowrap; }
.skp-legend::-webkit-scrollbar { display: none; }
.skp-chip { flex: none; display: inline-flex; align-items: center; gap: 4px; border: 1px solid rgba(232,226,208,.22); background: transparent; border-radius: 999px; padding: 3px 7px; font: inherit; font-size: 10.5px; letter-spacing: .02em; cursor: pointer; transition: background .14s, border-color .14s, color .14s; }
.skp-chip:hover { border-color: rgba(232,226,208,.5); }
.skp-chip.on { font-weight: 600; }
.skp-chipdot { width: 5px; height: 5px; border-radius: 50%; flex: none; }
.skp-chipn { font-family: ui-monospace, Consolas, monospace; font-size: 10px; opacity: .72; }
.skp-panel { position: fixed; right: 20px; bottom: 150px; width: 430px; max-width: calc(100vw - 48px); height: 616px; max-height: calc(100vh - 80px); display: flex; flex-direction: column;
  background: radial-gradient(120% 90% at 50% 26%, #122036 0%, #0B1524 52%, #070C14 100%);
  border: 1px solid rgba(201,162,39,.34); border-radius: 14px; box-shadow: 0 18px 48px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.03);
  z-index: 2147483601; overflow: hidden; color: #E8E2D0; }

.skp-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px 6px; }
.skp-title { flex: 1 1 auto; font-family: Georgia, "Times New Roman", "SimSun", serif; font-size: 13px; letter-spacing: .14em; color: #C9A227; }
.skp-title .skp-count { color: #9A8F6E; letter-spacing: .1em; }
.skp-btn { cursor: pointer; border: 1px solid rgba(201,162,39,.4); background: rgba(18,29,46,.7); color: #E4DCC6; border-radius: 6px; padding: 4px 9px; font: inherit; font-size: 11.5px; }
.skp-btn:hover { background: rgba(201,162,39,.18); }
.skp-btn.skp-primary { background: #C9A227; border-color: #C9A227; color: #0A1220; font-weight: 600; }
.skp-btn.skp-primary:hover { background: #D9B43A; }

.skp-searchwrap { padding: 0 14px 6px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid rgba(201,162,39,.28); margin-bottom: 2px; }
.skp-search { flex: 1 1 auto; min-width: 0; background: none; border: 0; border-bottom: 1px solid rgba(201,162,39,.3); color: #EDE6D4; padding: 5px 2px 6px; font: inherit; font-size: 12.5px; outline: none; }
.skp-search::placeholder { color: #7E7663; }

.skp-mapwrap { flex: 1 1 auto; min-height: 0; position: relative; }
.skp-map { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.skp-dial { fill: none; stroke: #C9A227; opacity: .16; }
.skp-tick { stroke: #C9A227; }
.skp-cross { stroke: #C9A227; opacity: .1; }
.skp-arc { fill: none; stroke-width: 2; opacity: .72; stroke-linecap: round; transition: opacity .16s, stroke-width .16s; }
.skp-arc.hi { opacity: 1; stroke-width: 3; }
.skp-arc.dim { opacity: .14; }
.skp-arc-cap { opacity: .9; }

.skp-cnst { font-family: "Songti SC", SimSun, Georgia, serif; font-size: 13px; font-weight: 600; letter-spacing: .06em; fill: #9A8F6E; paint-order: stroke; stroke: #0B1524; stroke-width: 3.4px; }
.skp-cnst.hi { font-weight: 700; }
.skp-cnsten { font-family: ui-monospace, Consolas, monospace; font-size: 8.5px; letter-spacing: .12em; fill: #9A8F6E; opacity: .78; paint-order: stroke; stroke: #0B1524; stroke-width: 3px; }
.skp-core { fill: none; stroke: #C9A227; stroke-opacity: .28; }
.skp-corenum { font-family: Georgia, "Times New Roman", serif; font-size: 25px; fill: #EDE6D4; }
.skp-corecap { font-family: ui-monospace, Consolas, monospace; font-size: 9.5px; letter-spacing: .3em; fill: #9A8F6E; }
.skp-node { cursor: pointer; }
.skp-node .glow { opacity: 0; transition: opacity .18s; }
.skp-node:hover .glow, .skp-node.sel .glow { opacity: .55; }
.skp-node .ring { fill: none; stroke-width: 1; opacity: .45; }
.skp-node .dot { transition: r .15s; }
.skp-node:hover .dot, .skp-node.sel .dot { r: 4.2; }
.skp-nlabel { font-family: Georgia, "Times New Roman", "SimSun", serif; font-size: 11px; fill: #E4DCC6; paint-order: stroke; stroke: #0B1524; stroke-width: 3px; pointer-events: none; opacity: 0; transition: opacity .12s; }
.skp-nlabel.show { opacity: 1; }

.skp-selection { border-top: 1px solid rgba(201,162,39,.28); padding: 9px 14px 11px; min-height: 78px; display: flex; flex-direction: column; justify-content: center; }
.skp-selname { font-family: Georgia, "Times New Roman", "SimSun", serif; font-size: 13.5px; color: #F3EEDC; letter-spacing: .01em; }
.skp-selsrc { font-family: ui-monospace, Consolas, monospace; font-size: 11px; letter-spacing: .14em; color: #9A8F6E; margin-left: 8px; }
.skp-seldesc { font-size: 11.5px; line-height: 1.55; color: #A9A392; margin: 3px 0 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.skp-selacts { display: flex; gap: 6px; margin-top: 8px; }
.skp-hint { color: #7A7261; font-size: 11.5px; letter-spacing: .1em; text-align: center; }

.skp-toast { position: fixed; right: 20px; bottom: 168px; background: #0E1725; border: 1px solid rgba(201,162,39,.45); color: #EDE6D4; padding: 7px 12px; border-radius: 8px; font-size: 12px; z-index: 2147483602; pointer-events: none; }
.skp-preview { white-space: pre-wrap; font-family: ui-monospace, Consolas, monospace; font-size: 11px; line-height: 1.55; background: rgba(0,0,0,.35); border: 1px solid rgba(201,162,39,.22); border-radius: 8px; padding: 10px; margin: 6px 12px 12px; overflow: auto; flex: 1 1 auto; color: #D8D2C0; }
.skp-previewbar { display: flex; align-items: center; gap: 8px; padding: 6px 14px 0; font-size: 11px; color: #9A8F6E; }
.skp-empty { padding: 28px 14px; text-align: center; color: #7E7663; font-size: 12px; }
`;

    function fetchJson(path, method) {
      return fetch(path, { method: method || "GET", cache: "no-store" }).then((r) =>
        r.json().then((body) => {
          if (!r.ok || (body && body.ok === false)) {
            const message = (body && body.error && body.error.message) || "HTTP " + r.status;
            throw new Error(message);
          }
          return body;
        })
      );
    }

    /** 找到聊天输入框：页面里最靠下的可见编辑区（排除插件面板自己的输入框）。 */
    function findComposer() {
      let nodes = [];
      try {
        nodes = Array.prototype.slice.call(
          document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')
        );
      } catch (e) {
        return null;
      }
      const usable = nodes.filter((node) => {
        if (!node || node.closest(".skp-root") || node.disabled || node.readOnly) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 40 && rect.height > 10;
      });
      usable.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
      return usable[0] || null;
    }

    function readComposer() {
      const target = findComposer();
      if (!target) return null;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return target.value || "";
      return target.innerText || "";
    }

    /** 把调用语写进聊天输入框（React 受控组件用 native setter + input 事件）。 */
    function writeToComposer(text) {
      const target = findComposer();
      if (!target) return false;
      try {
        target.focus();
        if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
          const proto = target.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
          setter.call(target, text);
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        // contenteditable：先全选旧内容，再插入，等于整段替换（否则会追加成两份）
        let ok = false;
        try {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(target);
          selection.removeAllRanges();
          selection.addRange(range);
          ok = document.execCommand("insertText", false, text);
        } catch (e) {
          ok = false;
        }
        if (!ok) {
          target.textContent = text;
          target.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
        }
        return true;
      } catch (e) {
        return false;
      }
    }

    /** 在输入框里触发发送（Enter）。不保证编辑器一定认，失败时用户手动回车即可。 */
    function sendComposer() {
      const target = findComposer();
      if (!target) return false;
      try {
        target.focus();
        const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
        for (const type of ["keydown", "keypress", "keyup"]) {
          target.dispatchEvent(new KeyboardEvent(type, init));
        }
        return true;
      } catch (e) {
        return false;
      }
    }

    function groupSkills(skills) {
      const order = CATEGORIES.map((c) => c.key);
      const map = {};
      for (const skill of skills) {
        const key = classify(skill);
        if (!map[key]) map[key] = [];
        map[key].push(skill);
      }
      const byKey = {};
      for (const cat of CATEGORIES) byKey[cat.key] = cat;
      return order
        .filter((key) => map[key] && map[key].length)
        .map((key) => {
          const cat = byKey[key];
          return { key, cn: cat.cn, short: cat.short, en: cat.en, color: cat.color, items: map[key] };
        });
    }

    /** 把分组摆到星盘上：每个分类一段弧，段内节点沿同一半径均布。 */
    function layoutNodes(groups) {
      const arcs = buildArcs(groups);
      const nodes = [];
      for (const group of groups) {
        const arc = arcs[group.key];
        const n = group.items.length;
        const span = arc.to - arc.from;
        const pad = n === 1 ? span / 2 : span * 0.14;
        group.items.forEach((skill, i) => {
          const t = n === 1 ? 0.5 : i / (n - 1);
          const deg = arc.from + pad + (span - 2 * pad) * t;
          const [x, y] = polar(arc.r, deg);
          nodes.push({ skill, key: group.key, cn: group.cn, color: group.color, source: resolveSource(skill), deg, x, y, arc });
        });
      }
      return nodes;
    }

    const svgEl = (tag, props, children) => h(tag, props, children);

    /** 星盘本体：同心刻度环 + 十字准线 + 三条弧 + 19 个节点。 */
    function StarMap({ nodes, groups, picked, query, onPick }) {
      const children = [];
      const key = (s) => "k" + s;

      // 刻度环
      [86, 136, 186, 216].forEach((r, i) =>
        children.push(svgEl("circle", { key: key("dial") + i, className: "skp-dial", cx: MAP_CX, cy: MAP_CY, r }))
      );
      // 每 15° 一条刻线，90° 的加长
      for (let deg = 0; deg < 360; deg += 15) {
        const big = deg % 90 === 0;
        const a = polar(206, deg);
        const b = polar(big ? 218 : 212, deg);
        children.push(
          svgEl("line", {
            key: key("tick") + deg,
            className: "skp-tick",
            x1: a[0], y1: a[1], x2: b[0], y2: b[1],
            strokeWidth: 1,
            opacity: big ? 0.34 : 0.16,
          })
        );
      }
      // 十字准线
      children.push(svgEl("line", { key: "cx", className: "skp-cross", x1: MAP_CX - 216, y1: MAP_CY, x2: MAP_CX + 216, y2: MAP_CY, strokeWidth: 1 }));
      children.push(svgEl("line", { key: "cy", className: "skp-cross", x1: MAP_CX, y1: MAP_CY - 216, x2: MAP_CX, y2: MAP_CY + 216, strokeWidth: 1 }));

      // 分类弧：整段弧 + 两端封口点 + 分类名（中文常显，是盘面上最重的一层标注）
      const arcs = buildArcs(groups);
      for (const group of groups) {
        const arc = arcs[group.key];
        if (!arc) continue;
        const color = group.color;
        const p0 = polar(arc.r, arc.from);
        const p1 = polar(arc.r, arc.to);
        const large = arc.to - arc.from > 180 ? 1 : 0;
        const isHi = picked && picked.key === group.key;
        children.push(
          svgEl("path", {
            key: key("arc") + group.key,
            className: "skp-arc" + (isHi ? " hi" : query && !isHi ? " dim" : ""),
            d: "M" + p0[0] + " " + p0[1] + " A" + arc.r + " " + arc.r + " 0 " + large + " 1 " + p1[0] + " " + p1[1],
            stroke: color,
          })
        );
        [p0, p1].forEach((p, i) =>
          children.push(svgEl("circle", {
            key: key("cap") + group.key + i, className: "skp-arc-cap", cx: p[0], cy: p[1], r: 2.2, fill: color,
          }))
        );
        const mid = (arc.from + arc.to) / 2;
        const tp = polar(arc.r + 32, mid);
        let tx = tp[0];
        let anchor = "middle";
        if (tx < 52) { tx = 52; anchor = "start"; }
        else if (tx > MAP_W - 52) { tx = MAP_W - 52; anchor = "end"; }
        children.push(
          svgEl("text", {
            key: key("cnst") + group.key,
            className: "skp-cnst" + (isHi ? " hi" : ""),
            x: tx, y: tp[1], textAnchor: anchor, fill: color,
          }, group.cn)
        );
        children.push(
          svgEl("text", {
            key: key("cnsten") + group.key,
            className: "skp-cnsten",
            x: tx, y: tp[1] + 11, textAnchor: anchor, fill: color,
          }, group.en + " · " + group.items.length)
        );
      }

      // 中心：19
      children.push(svgEl("circle", { key: "core", className: "skp-core", cx: MAP_CX, cy: MAP_CY, r: 30 }));
      children.push(svgEl("text", { key: "coren", className: "skp-corenum", x: MAP_CX, y: MAP_CY + 1, textAnchor: "middle" }, String(nodes.length)));
      children.push(svgEl("text", { key: "corec", className: "skp-corecap", x: MAP_CX, y: MAP_CY + 34, textAnchor: "middle" }, "SKILLS"));

      // 节点
      for (const node of nodes) {
        const color = SOURCE_COLORS[node.source] || "#8a8f9c";
        const isSel = picked && picked.name === node.skill.name;
        const matched = !query || (node.skill.name + " " + (node.skill.description || "")).toLowerCase().indexOf(query) >= 0;
        children.push(
          svgEl("g", {
            key: "n-" + node.skill.name,
            className: "skp-node" + (isSel ? " sel" : ""),
            onClick: (event) => { event.stopPropagation(); onPick(node); },
            style: { opacity: matched ? 1 : 0.15 },
          }, [
            svgEl("circle", { key: "g", className: "glow", cx: node.x, cy: node.y, r: 11, fill: color, filter: "url(#skpSoft)" }),
            svgEl("circle", { key: "r", className: "ring", cx: node.x, cy: node.y, r: 5.4, stroke: color }),
            svgEl("circle", { key: "d", className: "dot", cx: node.x, cy: node.y, r: 2.7, fill: color }),
          ])
        );
        // 标签朝圆心方向写，长名字才不会顶出面板左右边缘；只在选中/命中时出现
        const show = isSel || (query && matched);
        const dir = polar(node.arc.r - 26, node.deg);
        const cos = Math.cos(node.deg * RAD);
        const anchor = cos > 0.25 ? "end" : cos < -0.25 ? "start" : "middle";
        const shortName = node.skill.name.length > 18 ? node.skill.name.slice(0, 17) + "…" : node.skill.name;
        children.push(
          svgEl("text", {
            key: "l-" + node.skill.name,
            className: "skp-nlabel" + (show ? " show" : ""),
            x: dir[0], y: dir[1] + 4, textAnchor: anchor,
          }, shortName)
        );
      }

      return svgEl("svg", { className: "skp-map", viewBox: "0 0 " + MAP_W + " " + MAP_H, xmlns: "http://www.w3.org/2000/svg" }, [
        svgEl("defs", { key: "defs" }, [
          svgEl("filter", { key: "soft", id: "skpSoft", x: "-200%", y: "-200%", width: "500%", height: "500%" }, [
            svgEl("feGaussianBlur", { key: "b", stdDeviation: 4.2 }),
          ]),
        ]),
        children,
      ]);
    }

    function SkillDock() {
      const [open, setOpen] = useState(false);
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState(null);
      const [filter, setFilter] = useState("");
      const [preview, setPreview] = useState(null);
      const [toast, setToast] = useState("");
      const [picked, setPicked] = useState(null);
      const [cat, setCat] = useState(null);
      const rootRef = useRef(null);
      const toastTimer = useRef(null);

      function showToast(text) {
        setToast(text);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 1800);
      }

      function load(force) {
        setLoading(true);
        setError(null);
        fetchJson(force ? REFRESH_PATH : LIST_PATH, force ? "POST" : "GET")
          .then((body) => {
            setData(body);
            setLoading(false);
          })
          .catch((err) => {
            setLoading(false);
            setError(String(err && err.message ? err.message : err));
          });
      }

      useEffect(() => {
        load(false);
        return () => {
          if (toastTimer.current) clearTimeout(toastTimer.current);
        };
      }, []);

      useEffect(() => {
        if (!open) return undefined;
        function onKeydown(event) {
          if (event.key === "Escape") {
            if (preview) setPreview(null);
            else if (picked) setPicked(null);
            else setOpen(false);
          }
        }
        function onPointerDown(event) {
          if (rootRef.current && !rootRef.current.contains(event.target)) {
            setOpen(false);
            setPreview(null);
            setPicked(null);
          }
        }
        document.addEventListener("keydown", onKeydown);
        document.addEventListener("pointerdown", onPointerDown);
        return () => {
          document.removeEventListener("keydown", onKeydown);
          document.removeEventListener("pointerdown", onPointerDown);
        };
      }, [open, preview, picked]);

      /** 执行：把 skill 和你已经写好的需求组合成一轮对话，直接发出去。 */
      function run(skill) {
        const prefix = "使用 skill `" + skill.name + "` 完成任务：";
        const current = (readComposer() || "").trim();
        if (!current) {
          writeToComposer(prefix);
          setOpen(false);
          showToast("已插入 " + skill.name + "，补完需求后回车");
          return;
        }
        // 已经是一句调用语时只替换 skill 名，避免前缀越叠越长
        const matched = /^使用 skill `([^`]+)` 完成任务：([\s\S]*)$/.exec(current);
        let text;
        if (matched) {
          const rest = matched[2].trim();
          if (!rest) {
            setOpen(false);
            showToast("先在输入框里补完需求，再点执行");
            return;
          }
          text = prefix + rest;
        } else {
          text = prefix + current;
        }
        if (!writeToComposer(text)) {
          showToast("没找到聊天输入框，请手动输入 skill 名");
          return;
        }
        setOpen(false);
        showToast("正在发送：" + skill.name);
        setTimeout(() => {
          if (!sendComposer()) showToast("发送失败，请手动回车");
        }, 220);
      }

      function invoke(skill) {
        const text = "使用 skill `" + skill.name + "` 完成任务：";
        if (writeToComposer(text)) {
          showToast("已插入输入框：" + skill.name);
          setOpen(false);
        } else {
          try {
            navigator.clipboard.writeText(text);
            showToast("已复制调用语：" + skill.name);
          } catch (e) {
            showToast("插入失败，请手动输入：" + skill.name);
          }
        }
      }

      function look(skill) {
        setPreview({ name: skill.name, loading: true, content: "" });
        fetchJson(READ_PATH + "?name=" + encodeURIComponent(skill.name))
          .then((body) => setPreview({ name: body.name, path: body.path, loading: false, content: body.content }))
          .catch((err) => setPreview({ name: skill.name, loading: false, content: "", error: String(err && err.message ? err.message : err) }));
      }

      const total = data && data.skills ? data.skills.length : 0;
      const query = (filter || "").trim().toLowerCase();
      const filtered = useMemo(() => {
        if (!data || !data.skills) return [];
        if (!query) return data.skills;
        return data.skills.filter((skill) =>
          (skill.name + " " + (skill.description || "") + " " + (skill.whenToUse || "")).toLowerCase().indexOf(query) >= 0
        );
      }, [data, query]);
      const groups = useMemo(() => groupSkills(filtered), [filtered]);
      const shownGroups = useMemo(
        () => (cat ? groups.filter((g) => g.key === cat) : groups),
        [groups, cat]
      );
      const nodes = useMemo(() => layoutNodes(shownGroups), [shownGroups]);

      const children = [
        h("style", { key: "style" }, CSS),
        h("button", {
          key: "capsule",
          className: "skp-capsule",
          type: "button",
          title: "把本机全部 skill 画成一张星图，点节点就能调用",
          onClick: () => {
            const next = !open;
            setOpen(next);
            if (next && !data) load(false);
            if (!next) { setPreview(null); setPicked(null); }
          },
        }, ["🧩 Skills", total ? h("span", { key: "n", className: "skp-badge" }, String(total)) : null]),
      ];

      if (open) {
        const bodyChildren = [];
        if (preview) {
          bodyChildren.push(h("div", { key: "bar", className: "skp-previewbar" }, [
            h("span", { key: "name", style: { flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
              preview.name + (preview.path ? "  ·  " + preview.path : "")),
            h("button", { key: "back", className: "skp-btn", type: "button", onClick: () => setPreview(null) }, "返回星图"),
          ]));
          if (preview.loading) bodyChildren.push(h("div", { key: "loading", className: "skp-preview" }, "读取中…"));
          else if (preview.error) bodyChildren.push(h("div", { key: "err", className: "skp-preview" }, "读取失败：" + preview.error));
          else bodyChildren.push(h("div", { key: "content", className: "skp-preview" }, preview.content));
        } else if (loading) {
          bodyChildren.push(h("div", { key: "loading", className: "skp-empty" }, "扫描中…"));
        } else if (error) {
          bodyChildren.push(h("div", { key: "err", className: "skp-empty" }, "加载失败：" + error));
        } else if (!data) {
          bodyChildren.push(h("div", { key: "none", className: "skp-empty" }, "暂无数据"));
        } else if (!filtered.length) {
          bodyChildren.push(h("div", { key: "nomatch", className: "skp-empty" }, "没有匹配的 skill"));
        } else {
          bodyChildren.push(h("div", { key: "map", className: "skp-mapwrap" },
            h(StarMap, { nodes, groups: shownGroups, picked, query, onPick: (node) => {
              setPicked((prev) => (prev && prev.name === node.skill.name ? null : node));
            } })
          ));
        }

        // 底部：选中了就看选中项，否则给一句提示
        const sel = picked && picked.skill;
        bodyChildren.push(h("div", { key: "sel", className: "skp-selection" }, sel ? [
          h("div", { key: "t" }, [
            h("span", { key: "n", className: "skp-selname" }, sel.name),
            h("span", { key: "s", className: "skp-selsrc" }, (picked.cn || picked.key) + " · " + (SOURCE_CN[picked.source] || picked.source)),
          ]),
          h("p", { key: "d", className: "skp-seldesc" }, sel.description || ""),
          h("div", { key: "a", className: "skp-selacts" }, [
            h("button", { key: "run", className: "skp-btn skp-primary", type: "button", title: "组合成一轮对话，直接发送", onClick: () => run(sel) }, "执行"),
            h("button", { key: "use", className: "skp-btn", type: "button", title: "只把调用语插进输入框", onClick: () => invoke(sel) }, "插入"),
            h("button", { key: "look", className: "skp-btn", type: "button", onClick: () => look(sel) }, "看"),
            h("button", { key: "clr", className: "skp-btn", type: "button", onClick: () => setPicked(null) }, "取消"),
          ]),
        ] : [
          h("div", { key: "hint", className: "skp-hint" }, "六段弧 = 六个分类 · 点节点选中 · 悬停看名字"),
        ]));

        children.push(h("div", { key: "panel", className: "skp-panel" }, [
          h("div", { key: "head", className: "skp-head" }, [
            h("div", { key: "title", className: "skp-title" }, [
              "SKILL ATLAS ",
              h("span", { key: "c", className: "skp-count" }, "· " + filtered.length + "/" + total),
            ]),
            h("button", { key: "refresh", className: "skp-btn", type: "button", onClick: () => { setPreview(null); setPicked(null); load(true); } }, "刷新"),
            h("button", { key: "close", className: "skp-btn", type: "button", onClick: () => { setOpen(false); setPreview(null); setPicked(null); } }, "×"),
          ]),
          h("div", { key: "searchwrap", className: "skp-searchwrap" }, [
            h("input", {
              key: "search",
              className: "skp-search",
              type: "search",
              placeholder: "搜索 skill 名称或描述…",
              value: filter,
              autoFocus: true,
              onChange: (event) => setFilter(event.target.value),
            }),
          ]),
          groups.length > 1
            ? h("div", { key: "legend", className: "skp-legend" },
                groups.map((g) => {
                  const on = cat === g.key;
                  return h("button", {
                    key: g.key,
                    type: "button",
                    className: "skp-chip" + (on ? " on" : ""),
                    title: on ? "再看全部" : "只看「" + g.cn + "」",
                    style: on
                      ? { borderColor: g.color, background: g.color, color: "#0A1120" }
                      : { borderColor: "rgba(232,226,208,.22)", color: g.color },
                    onClick: () => { setCat(on ? null : g.key); setPicked(null); },
                  }, [
                    h("span", { key: "d", className: "skp-chipdot", style: { background: on ? "#0A1120" : g.color } }),
                    g.short || g.cn,
                    h("span", { key: "n", className: "skp-chipn" }, String(g.items.length)),
                  ]);
                })
              )
            : null,
          h("div", { key: "body", style: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 } }, bodyChildren),
        ]));
      }

      if (toast) children.push(h("div", { key: "toast", className: "skp-toast" }, toast));

      return h("div", { className: "skp-root", ref: rootRef }, children);
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        ctx.slots.inject("shell.overlay", () =>
          ctx.slots.register(
            { name: "shell.overlay", id: "skill-panel", order: 50 },
            SkillDock
          )
        );
      },
    };
  },
});
