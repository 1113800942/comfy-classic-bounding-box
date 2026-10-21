// Create Bounding Box for Notes 1.0 (Classic Bounding Box)
// Classic LiteGraph UI editor for drag-drawing bounding boxes.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_CLASS = "ClassicCreateBoundingBox";
const STATE_WIDGET = "boxes_json";
const DEFAULT_COLOR = "#8C8C8C";

const SINGLE_COLORS = [
  { name: "红", hex: "#EF0722" },
  { name: "蓝", hex: "#1F6BFF" },
  { name: "绿", hex: "#12B83A" },
  { name: "黄", hex: "#FFD200" },
  { name: "橙", hex: "#FF7A00" },
  { name: "紫", hex: "#8E3BFF" },
  { name: "青", hex: "#00C2D9" },
  { name: "粉", hex: "#FF3EA5" },
  { name: "白", hex: "#FFFFFF" },
  { name: "黑", hex: "#111111" },
];

const PALETTE_PRESETS = [
  { name: "红/蓝/绿", palette: ["#EF0722", "#1F6BFF", "#12B83A"] },
  { name: "红/绿/黄", palette: ["#EF0722", "#12B83A", "#FFD200"] },
];

// ---------- pure helpers ----------
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function normPalette(p) {
  if (!Array.isArray(p)) return [];
  return p.filter((c) => typeof c === "string" && HEX_RE.test(c)).map((c) => c.toUpperCase()).slice(0, 5);
}

function normBox(b) {
  let x = num(b.x), y = num(b.y), w = num(b.w), h = num(b.h);
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  return {
    x, y, w, h,
    type: b.type === "text" ? "text" : "obj",
    text: String(b.text ?? ""),
    desc: String(b.desc ?? ""),
    palette: normPalette(b.palette),
  };
}

function parseState(str) {
  try {
    const d = JSON.parse(str || "[]");
    const arr = Array.isArray(d) ? d : Array.isArray(d?.boxes) ? d.boxes : [];
    return arr.filter((o) => o && typeof o === "object").map(normBox);
  } catch {
    return [];
  }
}

function r5(v) {
  return Math.round(v * 100000) / 100000;
}

function serializeBoxes(boxes) {
  return JSON.stringify({
    version: 1,
    boxes: boxes.map((b) => ({
      x: r5(b.x), y: r5(b.y), w: r5(b.w), h: r5(b.h),
      type: b.type === "text" ? "text" : "obj",
      text: b.type === "text" ? b.text : "",
      desc: b.desc,
      palette: normPalette(b.palette),
    })),
  });
}

// Normalise a box after a resize/draw so w/h are positive and it stays inside 0..1.
function fixBox(b) {
  let x1 = Math.min(b.x, b.x + b.w), x2 = Math.max(b.x, b.x + b.w);
  let y1 = Math.min(b.y, b.y + b.h), y2 = Math.max(b.y, b.y + b.h);
  x1 = clamp01(x1); x2 = clamp01(x2); y1 = clamp01(y1); y2 = clamp01(y2);
  b.x = x1; b.y = y1; b.w = x2 - x1; b.h = y2 - y1;
  return b;
}

// Fit an aspect ratio inside a rectangle.
function fitRect(aspect, W, H, pad) {
  const aw = Math.max(1, W - pad * 2), ah = Math.max(1, H - pad * 2);
  let w = aw, h = aw / aspect;
  if (h > ah) { h = ah; w = ah * aspect; }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function handlePoints(b, r) {
  const x1 = r.x + b.x * r.w, y1 = r.y + b.y * r.h;
  const x2 = x1 + b.w * r.w, y2 = y1 + b.h * r.h;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  return { nw: [x1, y1], n: [cx, y1], ne: [x2, y1], e: [x2, cy], se: [x2, y2], s: [cx, y2], sw: [x1, y2], w: [x1, cy] };
}

function applyResize(orig, handle, fx, fy) {
  let x1 = orig.x, y1 = orig.y, x2 = orig.x + orig.w, y2 = orig.y + orig.h;
  if (handle.includes("w")) x1 = fx;
  if (handle.includes("e")) x2 = fx;
  if (handle.includes("n")) y1 = fy;
  if (handle.includes("s")) y2 = fy;
  return fixBox({ ...orig, x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
}

function applyMove(orig, dx, dy) {
  const x = Math.min(Math.max(orig.x + dx, 0), 1 - orig.w);
  const y = Math.min(Math.max(orig.y + dy, 0), 1 - orig.h);
  return { ...orig, x, y };
}

function boxLabel(b) {
  if (b.type === "text" && b.text) return `"${b.text}"${b.desc ? " — " + b.desc : ""}`;
  return b.desc || "";
}

function readableOn(hex) {
  const n = parseInt((hex || DEFAULT_COLOR).slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#000" : "#fff";
}

// ---------- drawing ----------
function drawScene(ctx, W, H, img, aspect, boxes, opts = {}) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = opts.bg || "#1b1b1b";
  ctx.fillRect(0, 0, W, H);
  const r = fitRect(aspect, W, H, opts.pad ?? 8);
  if (img) {
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
  } else {
    ctx.fillStyle = "#3a3a3a";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = "#888";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(opts.emptyText || "", r.x + r.w / 2, r.y + r.h / 2);
  }
  const fs = Math.max(10, Math.round(opts.fontSize || r.h / 48));
  boxes.forEach((b, i) => {
    const color = b.palette[0] || DEFAULT_COLOR;
    const x = r.x + b.x * r.w, y = r.y + b.y * r.h, w = b.w * r.w, h = b.h * r.h;
    ctx.save();
    ctx.lineWidth = i === opts.selected ? 3 : 2;
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);
    const sw = b.palette.slice(0, 5);
    if (sw.length && w > 2) {
      const seg = w / sw.length, sh = Math.max(4, Math.round(fs / 2));
      sw.forEach((c, k) => { ctx.fillStyle = c; ctx.fillRect(x + k * seg, y, seg, sh); });
    }
    const tag = String(i + 1).padStart(2, "0");
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const tw = ctx.measureText(tag).width;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, tw + 6, fs + 4);
    ctx.fillStyle = readableOn(color);
    ctx.fillText(tag, x + 3, y + 2);
    const label = (b.type === "text" ? "[T] " : "") + boxLabel(b);
    if (label && w > 16 && h > fs * 2) {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.font = `${fs}px sans-serif`;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      const lw = Math.min(w - 4, ctx.measureText(label).width + 6);
      ctx.fillRect(x + 2, y + fs + 6, lw, fs + 4);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x + 5, y + fs + 8);
    }
    ctx.restore();
    if (i === opts.selected) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
      ctx.setLineDash([]);
      const pts = handlePoints(b, r);
      for (const k of HANDLES) {
        const [hx, hy] = pts[k];
        ctx.fillStyle = "#fff";
        ctx.fillRect(hx - 4, hy - 4, 8, 8);
        ctx.strokeStyle = "#000";
        ctx.strokeRect(hx - 4, hy - 4, 8, 8);
      }
      ctx.restore();
    }
  });
  return r;
}

// ---------- image sources ----------
function viewUrl(info) {
  if (!info?.filename) return null;
  const q = new URLSearchParams({ filename: info.filename, subfolder: info.subfolder || "", type: info.type || "input" });
  return api.apiURL(`/view?${q.toString()}`);
}

function sourceNodeOf(node, slot) {
  let src = node.getInputNode?.(slot) ?? null;
  let link = node.getInputLink?.(slot) ?? null;
  const seen = new Set();
  for (let guard = 0; src && guard < 16; guard++) {
    if (src.isSubgraphNode?.()) {
      if (!link || seen.has(src)) return null;
      seen.add(src);
      const res = src.resolveSubgraphOutputLink?.(link.origin_slot);
      if (!res) return null;
      src = res.outputNode ?? null;
      link = res.link ?? null;
      continue;
    }
    if (src.type === "Reroute" && src.inputs?.length) {
      link = src.getInputLink?.(0) ?? null;
      src = src.getInputNode?.(0) ?? null;
      continue;
    }
    break;
  }
  return src;
}

function upstreamImageUrl(node) {
  const slot = node.inputs?.findIndex((i) => i.name === "background") ?? -1;
  if (slot < 0 || node.inputs[slot].link == null) return null;
  let src;
  try { src = sourceNodeOf(node, slot); } catch { return null; }
  if (!src) return null;
  const first = src.imgs?.[0];
  if (first?.src) return first.src;
  const w = src.widgets?.find((x) => x.name === "image" && typeof x.value === "string" && x.value);
  if (w) {
    let v = w.value.trim();
    let type = "input";
    const m = v.match(/^(.*)\s\[(input|output|temp)\]$/);
    if (m) { v = m[1]; type = m[2]; }
    const parts = v.split("/");
    const filename = parts.pop();
    return viewUrl({ filename, subfolder: parts.join("/"), type });
  }
  return null;
}

// ---------- node helpers ----------
function stateWidget(node) {
  return node.widgets?.find((w) => w.name === STATE_WIDGET);
}

function dims(node) {
  const W = num(node.widgets?.find((w) => w.name === "width")?.value) || 720;
  const H = num(node.widgets?.find((w) => w.name === "height")?.value) || 1280;
  return [W, H];
}

function readBoxes(node) {
  return parseState(stateWidget(node)?.value);
}

function writeBoxes(node, boxes) {
  const w = stateWidget(node);
  if (!w) return;
  const v = serializeBoxes(boxes);
  w.value = v;
  w.callback?.(v);
  node.setDirtyCanvas?.(true, true);
  try { app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.checkState?.(); } catch {}
}

function currentImageUrl(node) {
  return upstreamImageUrl(node) || node._cbb?.lastRunUrl || null;
}

function ensureImage(node, onReady) {
  const st = node._cbb;
  const url = currentImageUrl(node);
  if (url === st.imgUrl) return;
  st.imgUrl = url;
  st.img = null;
  if (!url) { onReady?.(); return; }
  const img = new Image();
  img.onload = () => { if (st.imgUrl === url) { st.img = img; onReady?.(); } };
  img.onerror = () => { if (st.imgUrl === url) { st.img = null; onReady?.(); } };
  img.src = url;
}

function aspectOf(node) {
  const img = node._cbb?.img;
  if (img?.naturalWidth && img?.naturalHeight) return img.naturalWidth / img.naturalHeight;
  const [W, H] = dims(node);
  return W / H;
}

// ---------- in-node preview ----------
function el(tag, props = {}, style = {}) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  Object.assign(e.style, style);
  return e;
}

function btnStyle(extra = {}) {
  return { padding: "3px 8px", border: "1px solid #555", borderRadius: "4px", background: "#2c2c2c", color: "#ddd", cursor: "pointer", fontSize: "12px", ...extra };
}

function setupPreview(node) {
  const root = el("div", {}, { display: "flex", flexDirection: "column", gap: "4px", width: "100%", height: "100%", boxSizing: "border-box" });
  const bar = el("div", {}, { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" });
  const editBtn = el("button", { textContent: "编辑框 Edit boxes" }, btnStyle({ background: "#2f5f9e", color: "#fff" }));
  const clearBtn = el("button", { textContent: "清空 Clear" }, btnStyle());
  const info = el("span", {}, { color: "#aaa", fontSize: "11px" });
  bar.append(editBtn, clearBtn, info);
  const canvas = el("canvas", {}, { width: "100%", flex: "1 1 auto", minHeight: "120px", borderRadius: "4px", cursor: "pointer" });
  root.append(bar, canvas);

  const redraw = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(10, Math.round(rect.width)), H = Math.max(10, Math.round(rect.height));
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const boxes = readBoxes(node);
    const [dw, dh] = dims(node);
    drawScene(ctx, W, H, node._cbb.img, aspectOf(node), boxes, { pad: 4, fontSize: 11, emptyText: `${dw}×${dh}` });
    info.textContent = `${boxes.length} 个框 · ${dw}×${dh}${node._cbb.img ? "" : " · 无背景"}`;
  };
  node._cbb.redraw = redraw;

  const open = (e) => { e?.stopPropagation?.(); ensureImage(node, redraw); openEditor(node); };
  editBtn.addEventListener("click", open);
  canvas.addEventListener("dblclick", open);
  canvas.addEventListener("click", open);
  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (readBoxes(node).length && confirm("清空这个节点上的所有框？")) { writeBoxes(node, []); redraw(); }
  });

  const w = node.addDOMWidget("cbb_preview", "classic_bbox_preview", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 200,
    getValue: () => "",
    setValue: () => {},
  });
  w.serialize = false;

  if (typeof ResizeObserver !== "undefined") {
    node._cbb.ro = new ResizeObserver(() => redraw());
    node._cbb.ro.observe(canvas);
  }
  node._cbb.timer = setInterval(() => {
    if (!node.graph) return;
    ensureImage(node, redraw);
  }, 1000);
  return redraw;
}

// ---------- full-screen editor ----------
function openEditor(node) {
  if (document.getElementById("cbb-editor-overlay")) return;
  const [dw, dh] = dims(node);
  let boxes = readBoxes(node);
  let selected = -1;
  let current = ["#EF0722"];
  let newType = "obj";
  let drag = null;
  let rect = { x: 0, y: 0, w: 1, h: 1 };

  const overlay = el("div", { id: "cbb-editor-overlay", tabIndex: -1 }, {
    position: "fixed", inset: "0", zIndex: "100000", background: "rgba(0,0,0,0.88)", display: "flex", flexDirection: "column",
    color: "#ddd", fontFamily: "sans-serif", fontSize: "13px", outline: "none",
  });
  // toolbar
  const top = el("div", {}, { display: "flex", alignItems: "center", gap: "6px", padding: "8px 10px", flexWrap: "wrap", borderBottom: "1px solid #333" });
  const title = el("b", { textContent: "Create Bounding Box for Notes 1.0" }, { marginRight: "8px" });
  top.append(title, el("span", { textContent: "颜色:" }));
  const colorButtons = [];
  const markActive = () => {
    const key = current.join(",");
    for (const { btn, pal } of colorButtons) btn.style.outline = pal.join(",") === key ? "2px solid #fff" : "none";
    curSwatch.style.background = current.length > 1 ? `linear-gradient(90deg, ${current.map((c, i) => `${c} ${i * 100 / current.length}%, ${c} ${(i + 1) * 100 / current.length}%`).join(", ")})` : current[0];
  };
  for (const c of SINGLE_COLORS) {
    const b = el("button", { title: `${c.name} ${c.hex}` }, { width: "22px", height: "22px", border: "1px solid #666", borderRadius: "4px", background: c.hex, cursor: "pointer", padding: "0" });
    b.addEventListener("click", () => { current = [c.hex]; markActive(); });
    colorButtons.push({ btn: b, pal: [c.hex] });
    top.append(b);
  }
  const custom = el("input", { type: "color", value: "#EF0722", title: "自定义颜色" }, { width: "28px", height: "24px", padding: "0", border: "none", background: "none", cursor: "pointer" });
  custom.addEventListener("input", () => { current = [custom.value.toUpperCase()]; markActive(); });
  top.append(custom, el("span", { textContent: "配色:" }, { marginLeft: "8px" }));
  for (const p of PALETTE_PRESETS) {
    const b = el("button", { title: p.name }, btnStyle({ display: "flex", alignItems: "center", gap: "4px" }));
    const sw = el("span", {}, { display: "inline-flex", height: "14px" });
    for (const c of p.palette) sw.append(el("span", {}, { width: "10px", height: "14px", background: c, display: "inline-block" }));
    b.append(sw, document.createTextNode(p.name));
    b.addEventListener("click", () => { current = p.palette.slice(); markActive(); });
    colorButtons.push({ btn: b, pal: p.palette });
    top.append(b);
  }
  top.append(el("span", { textContent: "当前:" }, { marginLeft: "8px" }));
  const curSwatch = el("span", {}, { width: "40px", height: "16px", display: "inline-block", border: "1px solid #888", borderRadius: "3px" });
  top.append(curSwatch);
  top.append(el("span", { textContent: "新框类型:" }, { marginLeft: "8px" }));
  const typeSel = el("select", {}, { background: "#222", color: "#ddd", border: "1px solid #555" });
  typeSel.append(new Option("物体 obj", "obj"), new Option("文字 text", "text"));
  typeSel.addEventListener("change", () => { newType = typeSel.value; });
  top.append(typeSel);
  top.append(el("span", {}, { flex: "1" }));
  const clearAll = el("button", { textContent: "清空全部" }, btnStyle());
  const cancel = el("button", { textContent: "取消 (Esc)" }, btnStyle());
  const done = el("button", { textContent: "完成" }, btnStyle({ background: "#2f7d32", color: "#fff" }));
  top.append(clearAll, cancel, done);

  // main
  const main = el("div", {}, { flex: "1", display: "flex", minHeight: "0" });
  const stageWrap = el("div", {}, { flex: "1", position: "relative", minWidth: "0" });
  const stage = el("canvas", {}, { position: "absolute", inset: "0", width: "100%", height: "100%", cursor: "crosshair", touchAction: "none" });
  stageWrap.append(stage);
  const side = el("div", {}, { width: "300px", borderLeft: "1px solid #333", padding: "8px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" });
  main.append(stageWrap, side);
  const hint = el("div", { textContent: `拖空白处画新框 · 拖框内移动 · 拖白色手柄调大小 · Delete 删除选中框 · 坐标网格 ${dw}×${dh}（需与 Create Bounding Boxes 的 width/height 相同）` }, { padding: "6px 10px", color: "#999", fontSize: "12px", borderTop: "1px solid #333" });
  overlay.append(top, main, hint);

  // side panel
  const list = el("div", {}, { display: "flex", flexDirection: "column", gap: "3px" });
  const editor = el("div", {}, { display: "flex", flexDirection: "column", gap: "6px", borderTop: "1px solid #333", paddingTop: "8px" });
  side.append(el("b", { textContent: "框列表（先背景后前景）" }), list, editor);

  const inputStyle = { background: "#222", color: "#ddd", border: "1px solid #555", borderRadius: "3px", padding: "4px", fontSize: "13px", boxSizing: "border-box", width: "100%" };
  const selType = el("select", {}, inputStyle);
  selType.append(new Option("物体 obj", "obj"), new Option("文字 text", "text"));
  const selText = el("input", { type: "text", placeholder: "文字内容（text 类型）" }, inputStyle);
  const selDesc = el("textarea", { rows: 4, placeholder: "描述 desc" }, { ...inputStyle, resize: "vertical" });
  const selPal = el("div", {}, { display: "flex", gap: "3px", alignItems: "center" });
  const useCur = el("button", { textContent: "改用当前颜色" }, btnStyle());
  const up = el("button", { textContent: "上移" }, btnStyle());
  const dn = el("button", { textContent: "下移" }, btnStyle());
  const del = el("button", { textContent: "删除" }, btnStyle({ background: "#7a2222", color: "#fff" }));
  const row = el("div", {}, { display: "flex", gap: "6px", flexWrap: "wrap" });
  row.append(useCur, up, dn, del);
  editor.append(el("span", { textContent: "类型" }), selType, el("span", { textContent: "文字" }), selText, el("span", { textContent: "描述" }), selDesc, el("span", { textContent: "颜色" }), selPal, row);

  const refreshSide = () => {
    list.replaceChildren();
    boxes.forEach((b, i) => {
      const item = el("div", {}, { display: "flex", alignItems: "center", gap: "6px", padding: "3px 4px", borderRadius: "3px", cursor: "pointer", background: i === selected ? "#2f4f7a" : "#262626" });
      const dots = el("span", {}, { display: "inline-flex" });
      (b.palette.length ? b.palette : [DEFAULT_COLOR]).forEach((c) => dots.append(el("span", {}, { width: "8px", height: "12px", background: c, display: "inline-block" })));
      const txt = el("span", { textContent: `${String(i + 1).padStart(2, "0")} ${b.type} ${boxLabel(b)}`.trim() }, { overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" });
      item.append(dots, txt);
      item.addEventListener("click", () => { selected = i; refreshSide(); draw(); });
      list.append(item);
    });
    if (!boxes.length) list.append(el("span", { textContent: "还没有框，在左边拖动画一个。" }, { color: "#888" }));
    const b = boxes[selected];
    editor.style.display = b ? "flex" : "none";
    if (b) {
      selType.value = b.type;
      selText.value = b.text;
      selText.disabled = b.type !== "text";
      selDesc.value = b.desc;
      selPal.replaceChildren(...(b.palette.length ? b.palette : [DEFAULT_COLOR]).map((c) => el("span", { title: c }, { width: "18px", height: "18px", background: c, display: "inline-block", border: "1px solid #666" })));
    }
  };

  selType.addEventListener("change", () => { const b = boxes[selected]; if (!b) return; b.type = selType.value; refreshSide(); draw(); });
  selText.addEventListener("input", () => { const b = boxes[selected]; if (!b) return; b.text = selText.value; draw(); refreshList(); });
  selDesc.addEventListener("input", () => { const b = boxes[selected]; if (!b) return; b.desc = selDesc.value; draw(); refreshList(); });
  const refreshList = () => {
    const items = list.children;
    boxes.forEach((b, i) => { const t = items[i]?.lastChild; if (t) t.textContent = `${String(i + 1).padStart(2, "0")} ${b.type} ${boxLabel(b)}`.trim(); });
  };
  useCur.addEventListener("click", () => { const b = boxes[selected]; if (!b) return; b.palette = current.slice(); refreshSide(); draw(); });
  up.addEventListener("click", () => { if (selected > 0) { [boxes[selected - 1], boxes[selected]] = [boxes[selected], boxes[selected - 1]]; selected--; refreshSide(); draw(); } });
  dn.addEventListener("click", () => { if (selected >= 0 && selected < boxes.length - 1) { [boxes[selected + 1], boxes[selected]] = [boxes[selected], boxes[selected + 1]]; selected++; refreshSide(); draw(); } });
  const deleteSelected = () => { if (selected >= 0) { boxes.splice(selected, 1); selected = -1; refreshSide(); draw(); } };
  del.addEventListener("click", deleteSelected);

  // stage drawing
  const draw = () => {
    const r = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(10, Math.round(r.width)), H = Math.max(10, Math.round(r.height));
    if (stage.width !== W * dpr || stage.height !== H * dpr) { stage.width = W * dpr; stage.height = H * dpr; }
    const ctx = stage.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rect = drawScene(ctx, W, H, node._cbb.img, aspectOf(node), boxes, { pad: 20, selected, emptyText: `无背景图 · ${dw}×${dh}` });
  };

  const toLocal = (e) => {
    const r = stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const toFrac = (px, py) => [clamp01((px - rect.x) / rect.w), clamp01((py - rect.y) / rect.h)];
  const hitHandle = (px, py) => {
    const b = boxes[selected];
    if (!b) return null;
    const pts = handlePoints(b, rect);
    for (const k of HANDLES) { const [hx, hy] = pts[k]; if (Math.abs(px - hx) <= 7 && Math.abs(py - hy) <= 7) return k; }
    return null;
  };
  const hitBox = (fx, fy) => {
    for (let i = boxes.length - 1; i >= 0; i--) { const b = boxes[i]; if (fx >= b.x && fx <= b.x + b.w && fy >= b.y && fy <= b.y + b.h) return i; }
    return -1;
  };
  const CURSORS = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    overlay.focus();
    const [px, py] = toLocal(e);
    const [fx, fy] = toFrac(px, py);
    const h = hitHandle(px, py);
    if (h) {
      drag = { mode: "resize", handle: h, orig: { ...boxes[selected] } };
    } else {
      const i = hitBox(fx, fy);
      if (i >= 0) {
        selected = i;
        drag = { mode: "move", sx: fx, sy: fy, orig: { ...boxes[i] } };
      } else {
        const nb = { x: fx, y: fy, w: 0, h: 0, type: newType, text: "", desc: "", palette: current.slice() };
        boxes.push(nb);
        selected = boxes.length - 1;
        drag = { mode: "draw", sx: fx, sy: fy };
      }
    }
    stage.setPointerCapture?.(e.pointerId);
    refreshSide();
    draw();
  });
  stage.addEventListener("pointermove", (e) => {
    const [px, py] = toLocal(e);
    const [fx, fy] = toFrac(px, py);
    if (!drag) {
      const h = hitHandle(px, py);
      stage.style.cursor = h ? CURSORS[h] : hitBox(fx, fy) >= 0 ? "move" : "crosshair";
      return;
    }
    const b = boxes[selected];
    if (!b) return;
    if (drag.mode === "draw") {
      Object.assign(b, fixBox({ ...b, x: drag.sx, y: drag.sy, w: fx - drag.sx, h: fy - drag.sy }));
    } else if (drag.mode === "move") {
      Object.assign(b, applyMove(drag.orig, fx - drag.sx, fy - drag.sy));
    } else if (drag.mode === "resize") {
      Object.assign(b, applyResize(drag.orig, drag.handle, fx, fy));
    }
    draw();
  });
  const endDrag = (e) => {
    if (!drag) return;
    const b = boxes[selected];
    if (b && (b.w * rect.w < 4 || b.h * rect.h < 4)) {
      if (drag.mode === "draw") { boxes.splice(selected, 1); selected = -1; }
      else if (drag.orig) Object.assign(b, drag.orig);
    }
    drag = null;
    try { stage.releasePointerCapture?.(e.pointerId); } catch {}
    refreshSide();
    draw();
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // keep keys and pointer events away from the graph while the editor is open
  const stop = (e) => e.stopPropagation();
  for (const t of ["pointerdown", "pointermove", "pointerup", "mousedown", "mousemove", "mouseup", "wheel", "contextmenu", "dblclick", "click", "keyup", "keypress", "paste", "copy", "cut"]) overlay.addEventListener(t, stop);
  overlay.addEventListener("keydown", (e) => {
    e.stopPropagation();
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "");
    if (e.key === "Escape") { close(false); return; }
    if (typing) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); }
  });

  const close = (save) => {
    if (save) {
      writeBoxes(node, boxes.filter((b) => b.w > 0 && b.h > 0));
      node._cbb.redraw?.();
    }
    window.removeEventListener("resize", draw);
    overlay.remove();
  };
  clearAll.addEventListener("click", () => { if (!boxes.length || confirm("清空全部框？")) { boxes = []; selected = -1; refreshSide(); draw(); } });
  cancel.addEventListener("click", () => close(false));
  done.addEventListener("click", () => close(true));
  window.addEventListener("resize", draw);

  document.body.append(overlay);
  overlay.focus();
  markActive();
  refreshSide();
  ensureImage(node, () => { draw(); node._cbb.redraw?.(); });
  requestAnimationFrame(draw);
}

// ---------- extension ----------
app.registerExtension({
  name: "ClassicBoundingBox.CreateBoundingBoxForNotes1",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated?.apply(this, arguments);
      this._cbb = { img: null, imgUrl: undefined, lastRunUrl: null };
      const sw = stateWidget(this);
      if (sw) {
        sw.hidden = true;
        if (sw.options) sw.options.hidden = true;
      }
      const redraw = setupPreview(this);
      for (const name of ["width", "height"]) {
        const w = this.widgets?.find((x) => x.name === name);
        if (!w) continue;
        const cb = w.callback;
        w.callback = function () { const res = cb?.apply(this, arguments); redraw(); return res; };
      }
      const [w0, h0] = this.size || [0, 0];
      this.setSize?.([Math.max(w0, 320), Math.max(h0, 380)]);
      ensureImage(this, redraw);
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      if (this._cbb) setTimeout(() => { ensureImage(this, this._cbb.redraw); this._cbb.redraw?.(); }, 0);
      return r;
    };

    const onConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = onConnectionsChange?.apply(this, arguments);
      if (this._cbb) ensureImage(this, this._cbb.redraw);
      return r;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const r = onExecuted?.apply(this, arguments);
      const bg = message?.classic_bbox_bg;
      if (this._cbb && Array.isArray(bg) && bg[0]) {
        this._cbb.lastRunUrl = viewUrl(bg[0]);
        ensureImage(this, this._cbb.redraw);
      }
      return r;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._cbb) {
        clearInterval(this._cbb.timer);
        this._cbb.ro?.disconnect();
      }
      return onRemoved?.apply(this, arguments);
    };
  },
});
