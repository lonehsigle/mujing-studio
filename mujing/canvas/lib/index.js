var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name3 in all)
    __defProp(target, name3, { get: all[name3], enumerable: true });
};

// mujing/canvas/src/host/service.ts
import { homedir as homedir2 } from "node:os";
import { extname as extname2, join as join4 } from "node:path";
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

// mujing/canvas/src/host/store.ts
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
var ID = /^[A-Za-z0-9_-]{1,64}$/;
var MAX_HISTORY = 40;
var DEFAULT_SIZE = {
  text: [320, 200],
  image: [320, 320],
  video: [384, 216],
  audio: [320, 128]
};
var NODE_TYPES = ["text", "image", "video", "audio"];
var ProjectNotFoundError = class extends Error {
  code = "MUJING_PROJECT_NOT_FOUND";
  constructor(id) {
    super(`\u753B\u5E03\u9879\u76EE\u4E0D\u5B58\u5728\uFF1A${id}`);
  }
};
var CanvasOpError = class extends Error {
  code = "MUJING_INVALID_OP";
};
function shortId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}
function takeSnapshot(p) {
  return structuredClone({
    nodes: p.nodes,
    edges: p.edges,
    ...p.drama !== void 0 ? { drama: p.drama } : {},
    ...p.timeline !== void 0 ? { timeline: p.timeline } : {}
  });
}
function restoreSnapshot(p, snap) {
  const cloned = structuredClone(snap);
  p.nodes = cloned.nodes;
  p.edges = cloned.edges;
  p.drama = cloned.drama;
  p.timeline = cloned.timeline;
}
function sanitizeStatus(raw, fallback = "idle") {
  if (raw === "success" || raw === "error" || raw === "idle") return raw;
  if (raw === "loading") return "idle";
  return fallback;
}
function sanitizeDrama(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return void 0;
  const obj = raw;
  const aspectRatio = obj.aspectRatio === "16:9" || obj.aspectRatio === "1:1" ? obj.aspectRatio : "9:16";
  const rawCasts = Array.isArray(obj.casts) ? obj.casts : [];
  const casts = rawCasts.filter((c) => typeof c === "object" && c !== null && !Array.isArray(c) && typeof c.name === "string" && Boolean(c.name)).map((c) => {
    const kind = c.kind === "scene" || c.kind === "prop" ? c.kind : "character";
    const name3 = String(c.name).trim();
    const appearance = typeof c.appearance === "string" ? c.appearance : "";
    return {
      id: typeof c.id === "string" && ID.test(c.id) ? c.id : shortId("cast"),
      kind,
      name: name3,
      ...typeof c.role === "string" && c.role.trim() ? { role: c.role.trim() } : {},
      appearance,
      imagePrompt: typeof c.imagePrompt === "string" && c.imagePrompt.trim() ? c.imagePrompt : `${name3}\uFF0C${appearance}`,
      ...typeof c.voice === "string" && c.voice.trim() ? { voice: c.voice.trim() } : {},
      ...typeof c.imageNodeId === "string" && c.imageNodeId ? { imageNodeId: c.imageNodeId } : {},
      ...typeof c.imageUrl === "string" && c.imageUrl ? { imageUrl: c.imageUrl } : {},
      ...typeof c.locked === "boolean" ? { locked: c.locked } : {}
    };
  });
  const rawEpisodes = Array.isArray(obj.episodes) ? obj.episodes : [];
  const episodes = rawEpisodes.filter((e) => typeof e === "object" && e !== null && !Array.isArray(e)).map((e, epIdx) => {
    const num = typeof e.number === "number" && Number.isFinite(e.number) && e.number >= 1 ? Math.floor(e.number) : epIdx + 1;
    const rawShots = Array.isArray(e.shots) ? e.shots : [];
    const shots = rawShots.filter((s) => typeof s === "object" && s !== null && !Array.isArray(s)).map((s) => {
      const transition = s.transition === "fadeblack" || s.transition === "fadewhite" ? s.transition : s.transition === "cut" ? "cut" : void 0;
      return {
        id: typeof s.id === "string" && ID.test(s.id) ? s.id : shortId("shot"),
        segmentIndex: typeof s.segmentIndex === "number" && Number.isFinite(s.segmentIndex) && s.segmentIndex >= 0 ? Math.floor(s.segmentIndex) : 0,
        scene: typeof s.scene === "string" ? s.scene : "\u4E3B\u573A\u666F",
        shotSize: typeof s.shotSize === "string" ? s.shotSize : "\u4E2D\u666F",
        camera: typeof s.camera === "string" ? s.camera : "\u56FA\u5B9A",
        action: typeof s.action === "string" ? s.action : "",
        ...typeof s.imagePrompt === "string" && s.imagePrompt ? { imagePrompt: s.imagePrompt } : {},
        ...typeof s.videoPrompt === "string" && s.videoPrompt ? { videoPrompt: s.videoPrompt } : {},
        ...typeof s.speaker === "string" && s.speaker ? { speaker: s.speaker } : {},
        ...typeof s.dialogue === "string" && s.dialogue ? { dialogue: s.dialogue } : {},
        durationMs: typeof s.durationMs === "number" && Number.isFinite(s.durationMs) && s.durationMs >= 500 ? Math.round(s.durationMs) : 3500,
        ...Array.isArray(s.castIds) ? { castIds: s.castIds.filter((x) => typeof x === "string") } : {},
        ...transition ? { transition } : {},
        ...typeof s.keyframeNodeId === "string" && s.keyframeNodeId ? { keyframeNodeId: s.keyframeNodeId } : {},
        ...typeof s.keyframeUrl === "string" && s.keyframeUrl ? { keyframeUrl: s.keyframeUrl } : {},
        ...typeof s.audioNodeId === "string" && s.audioNodeId ? { audioNodeId: s.audioNodeId } : {},
        ...typeof s.audioUrl === "string" && s.audioUrl ? { audioUrl: s.audioUrl } : {}
      };
    });
    const rawSegs = Array.isArray(e.segments) ? e.segments : [];
    const segments = rawSegs.filter((g) => typeof g === "object" && g !== null && !Array.isArray(g)).map((g, segIdx) => {
      const handoff = g.handoff === "continue" || g.handoff === "reverse_angle" ? g.handoff : "scene_cut";
      return {
        id: typeof g.id === "string" && ID.test(g.id) ? g.id : shortId("seg"),
        index: typeof g.index === "number" && Number.isFinite(g.index) && g.index >= 0 ? Math.floor(g.index) : segIdx,
        title: typeof g.title === "string" && g.title.trim() ? g.title.trim() : `\u7B2C${num}\u96C6\xB7\u7B2C${segIdx + 1}\u6BB5`,
        handoff,
        durationMs: typeof g.durationMs === "number" && Number.isFinite(g.durationMs) && g.durationMs >= 500 ? Math.round(g.durationMs) : 5e3,
        prompt: typeof g.prompt === "string" ? g.prompt : "",
        ...typeof g.videoNodeId === "string" && g.videoNodeId ? { videoNodeId: g.videoNodeId } : {},
        ...typeof g.firstFrameUrl === "string" && g.firstFrameUrl ? { firstFrameUrl: g.firstFrameUrl } : {},
        status: sanitizeStatus(g.status),
        ...typeof g.error === "string" && g.error ? { error: g.error } : {}
      };
    });
    return {
      id: typeof e.id === "string" && ID.test(e.id) ? e.id : shortId("ep"),
      number: num,
      title: typeof e.title === "string" && e.title.trim() ? e.title.trim() : `\u7B2C${num}\u96C6`,
      synopsis: typeof e.synopsis === "string" ? e.synopsis : "",
      ...typeof e.hook === "string" && e.hook ? { hook: e.hook } : {},
      ...typeof e.cliffhanger === "string" && e.cliffhanger ? { cliffhanger: e.cliffhanger } : {},
      ...typeof e.sourceText === "string" && e.sourceText ? { sourceText: e.sourceText } : {},
      shots,
      segments,
      ...typeof e.finalVideoUrl === "string" && e.finalVideoUrl ? { finalVideoUrl: e.finalVideoUrl } : {},
      ...typeof e.subtitleSrt === "string" && e.subtitleSrt ? { subtitleSrt: e.subtitleSrt } : {}
    };
  });
  return {
    ...typeof obj.genre === "string" && obj.genre.trim() ? { genre: obj.genre.trim() } : {},
    ...typeof obj.logline === "string" && obj.logline.trim() ? { logline: obj.logline.trim() } : {},
    style: typeof obj.style === "string" && obj.style.trim() ? obj.style.trim() : "\u7535\u5F71\u7EA7\u771F\u4EBA\u77ED\u5267\uFF0C\u7EC6\u817B\u81EA\u7136\u5149\u5F71\uFF0C8K\u8D28\u611F",
    aspectRatio,
    language: typeof obj.language === "string" && obj.language.trim() ? obj.language.trim() : "\u4E2D\u6587\u666E\u901A\u8BDD",
    segmentTargetSec: typeof obj.segmentTargetSec === "number" && Number.isFinite(obj.segmentTargetSec) ? Math.max(3, Math.min(15, Math.round(obj.segmentTargetSec))) : 8,
    ...typeof obj.novelText === "string" && obj.novelText ? { novelText: obj.novelText } : {},
    casts,
    episodes
  };
}
function sanitizeTimeline(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return void 0;
  const obj = raw;
  const rawClips = Array.isArray(obj.clips) ? obj.clips : [];
  const clips = rawClips.filter((c) => typeof c === "object" && c !== null && !Array.isArray(c) && typeof c.url === "string" && Boolean(c.url)).map((c, idx) => {
    const rawAudioClips = Array.isArray(c.audioClips) ? c.audioClips : [];
    const audioClips = rawAudioClips.filter((a) => typeof a === "object" && a !== null && !Array.isArray(a) && typeof a.url === "string" && Boolean(a.url)).map((a) => ({
      url: String(a.url),
      ...typeof a.nodeId === "string" && a.nodeId ? { nodeId: a.nodeId } : {},
      ...typeof a.startOffsetMs === "number" && Number.isFinite(a.startOffsetMs) && a.startOffsetMs >= 0 ? { startOffsetMs: Math.round(a.startOffsetMs) } : {},
      ...typeof a.durationMs === "number" && Number.isFinite(a.durationMs) && a.durationMs > 0 ? { durationMs: Math.round(a.durationMs) } : {},
      ...typeof a.title === "string" && a.title ? { title: a.title } : {}
    }));
    return {
      id: typeof c.id === "string" && ID.test(c.id) ? c.id : shortId("clip"),
      ...typeof c.nodeId === "string" && c.nodeId ? { nodeId: c.nodeId } : {},
      title: typeof c.title === "string" && c.title.trim() ? c.title.trim() : `\u7247\u6BB5 ${idx + 1}`,
      url: String(c.url),
      durationMs: typeof c.durationMs === "number" && Number.isFinite(c.durationMs) && c.durationMs >= 500 ? Math.round(c.durationMs) : 5e3,
      ...typeof c.caption === "string" ? { caption: c.caption } : {},
      ...typeof c.audioNodeId === "string" && c.audioNodeId ? { audioNodeId: c.audioNodeId } : {},
      ...typeof c.audioUrl === "string" && c.audioUrl ? { audioUrl: c.audioUrl } : {},
      ...audioClips.length > 0 ? { audioClips } : {}
    };
  });
  return {
    clips,
    ...typeof obj.burnSubtitles === "boolean" ? { burnSubtitles: obj.burnSubtitles } : {},
    ...typeof obj.outputUrl === "string" && obj.outputUrl ? { outputUrl: obj.outputUrl } : {},
    ...typeof obj.subtitleSrt === "string" ? { subtitleSrt: obj.subtitleSrt } : {},
    ...typeof obj.subtitleAssetUrl === "string" && obj.subtitleAssetUrl ? { subtitleAssetUrl: obj.subtitleAssetUrl } : {},
    status: sanitizeStatus(obj.status),
    ...typeof obj.error === "string" && obj.error ? { error: obj.error } : {},
    updatedAt: typeof obj.updatedAt === "number" && Number.isFinite(obj.updatedAt) ? obj.updatedAt : Date.now()
  };
}
var ProjectStore = class {
  /** 项目变化事件：`change`(project)、`delete`(id)。 */
  events = new EventEmitter();
  locks = /* @__PURE__ */ new Map();
  undoStacks = /* @__PURE__ */ new Map();
  redoStacks = /* @__PURE__ */ new Map();
  dir;
  constructor(dataDir) {
    this.dir = join(dataDir, "projects");
    this.events.setMaxListeners(0);
  }
  file(id) {
    if (!ID.test(id)) throw new ProjectNotFoundError(id);
    return join(this.dir, `${id}.json`);
  }
  /** 同一项目的读改写串行执行，避免 Agent 与 UI 并发写丢更新。 */
  serial(id, task) {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(task, task);
    const tail = next.catch(() => {
    });
    this.locks.set(id, tail);
    void tail.then(() => {
      if (this.locks.get(id) === tail) this.locks.delete(id);
    });
    return next;
  }
  historyStatus(id) {
    return {
      canUndo: (this.undoStacks.get(id)?.length ?? 0) > 0,
      canRedo: (this.redoStacks.get(id)?.length ?? 0) > 0
    };
  }
  pushUndo(id, snap) {
    const stack = this.undoStacks.get(id) ?? [];
    stack.push(snap);
    if (stack.length > MAX_HISTORY) stack.shift();
    this.undoStacks.set(id, stack);
    this.redoStacks.delete(id);
  }
  async list() {
    await mkdir(this.dir, { recursive: true });
    const out = [];
    for (const name3 of await readdir(this.dir)) {
      if (!name3.endsWith(".json")) continue;
      try {
        const p = await this.get(name3.slice(0, -5));
        const coverUrl = p.drama?.casts.find((c) => c.imageUrl)?.imageUrl ?? p.nodes.find((n) => n.type === "image" && n.url)?.url;
        out.push({
          id: p.id,
          title: p.title,
          updatedAt: p.updatedAt,
          nodeCount: p.nodes.length,
          ...p.drama?.aspectRatio ? { aspectRatio: p.drama.aspectRatio } : {},
          ...p.drama?.style ? { style: p.drama.style } : {},
          ...p.drama?.casts.length ? { castCount: p.drama.casts.length } : {},
          ...p.drama?.episodes.length ? { episodeCount: p.drama.episodes.length } : {},
          ...p.timeline?.clips.length ? { clipCount: p.timeline.clips.length } : {},
          ...coverUrl ? { coverUrl } : {}
        });
      } catch {
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async get(id) {
    let text;
    try {
      text = await readFile(this.file(id), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") throw new ProjectNotFoundError(id);
      throw error;
    }
    return JSON.parse(text);
  }
  async write(project) {
    await mkdir(this.dir, { recursive: true });
    const target = this.file(project.id);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(project, null, 2));
    await rename(tmp, target);
  }
  async create(title) {
    const now = Date.now();
    const project = {
      id: shortId("p"),
      title: title.trim() || "\u672A\u547D\u540D\u753B\u5E03",
      createdAt: now,
      updatedAt: now,
      rev: 1,
      nodes: [],
      edges: []
    };
    await this.write(project);
    this.events.emit("change", project);
    return project;
  }
  /** 导入外部画布 JSON（生成新 id，保留节点、连线、短剧与时间线结构）。 */
  async importProject(payload) {
    const now = Date.now();
    const id = shortId("p");
    const nodes = Array.isArray(payload.nodes) ? payload.nodes.filter((n) => n && typeof n.id === "string" && NODE_TYPES.includes(n.type)).map((n) => {
      const [dw, dh] = DEFAULT_SIZE[n.type];
      return {
        ...n,
        x: Number.isFinite(n.x) ? n.x : 80,
        y: Number.isFinite(n.y) ? n.y : 80,
        width: Number.isFinite(n.width) && n.width > 0 ? n.width : dw,
        height: Number.isFinite(n.height) && n.height > 0 ? n.height : dh,
        status: n.status === "loading" ? "idle" : n.status ?? (n.url ? "success" : "idle")
      };
    }) : [];
    const validIds = new Set(nodes.map((n) => n.id));
    const edges = Array.isArray(payload.edges) ? payload.edges.filter((e) => e && validIds.has(e.source) && validIds.has(e.target) && e.source !== e.target).map((e) => ({
      id: typeof e.id === "string" && ID.test(e.id) ? e.id : shortId("e"),
      source: e.source,
      target: e.target
    })) : [];
    const drama = sanitizeDrama(payload.drama);
    const timeline = sanitizeTimeline(payload.timeline);
    const project = {
      id,
      title: (typeof payload.title === "string" ? payload.title.trim() : "") || "\u5BFC\u5165\u753B\u5E03",
      createdAt: now,
      updatedAt: now,
      rev: 1,
      nodes,
      edges,
      ...drama ? { drama } : {},
      ...timeline ? { timeline } : {}
    };
    await this.write(project);
    this.events.emit("change", project);
    return project;
  }
  async rename(id, title) {
    return this.mutate(id, (p) => {
      p.title = title.trim() || p.title;
    }, false);
  }
  async remove(id) {
    await this.serial(id, async () => {
      await this.get(id);
      await rm(this.file(id), { force: true });
    });
    this.undoStacks.delete(id);
    this.redoStacks.delete(id);
    this.events.emit("delete", id);
  }
  /** 应用一组画布操作；任一操作非法则整组不落盘。返回新项目与新增节点 id。 */
  async apply(id, ops, recordUndo = true) {
    const created = [];
    const isStatusOnly = ops.length > 0 && ops.every((o) => {
      if (o.op !== "update_node") return false;
      const keys = Object.keys(o).filter((k) => k !== "op" && k !== "id");
      return keys.every((k) => k === "status" || k === "error" || k === "url" || k === "model" || k === "durationMs");
    });
    const project = await this.mutate(id, (p) => {
      for (const op of ops) applyOp(p, op, created);
    }, recordUndo && !isStatusOnly);
    return { project, created };
  }
  /** 直接变更项目的扩展域（如 drama / timeline）。 */
  async updateDomain(id, fn, recordUndo = true) {
    return this.mutate(id, fn, recordUndo);
  }
  async undo(id) {
    let undone = false;
    const project = await this.serial(id, async () => {
      const p = await this.get(id);
      const stack = this.undoStacks.get(id);
      const prev = stack?.pop();
      if (prev === void 0) return p;
      const redo = this.redoStacks.get(id) ?? [];
      redo.push(takeSnapshot(p));
      this.redoStacks.set(id, redo);
      restoreSnapshot(p, prev);
      p.rev += 1;
      p.updatedAt = Date.now();
      await this.write(p);
      undone = true;
      return p;
    });
    if (undone) this.events.emit("change", project);
    return { project, undone, changed: undone };
  }
  async redo(id) {
    let redone = false;
    const project = await this.serial(id, async () => {
      const p = await this.get(id);
      const stack = this.redoStacks.get(id);
      const next = stack?.pop();
      if (next === void 0) return p;
      const undo = this.undoStacks.get(id) ?? [];
      undo.push(takeSnapshot(p));
      this.undoStacks.set(id, undo);
      restoreSnapshot(p, next);
      p.rev += 1;
      p.updatedAt = Date.now();
      await this.write(p);
      redone = true;
      return p;
    });
    if (redone) this.events.emit("change", project);
    return { project, redone, changed: redone };
  }
  async mutate(id, fn, recordUndo = true) {
    const project = await this.serial(id, async () => {
      const p = await this.get(id);
      const before = recordUndo ? takeSnapshot(p) : void 0;
      fn(p);
      if (before !== void 0) this.pushUndo(id, before);
      p.rev += 1;
      p.updatedAt = Date.now();
      await this.write(p);
      return p;
    });
    this.events.emit("change", project);
    return project;
  }
};
function findNode(p, id) {
  const node = p.nodes.find((n) => n.id === id);
  if (node === void 0) throw new CanvasOpError(`\u8282\u70B9\u4E0D\u5B58\u5728\uFF1A${id}`);
  return node;
}
function nextPosition(p) {
  if (p.nodes.length === 0) return { x: 80, y: 80 };
  const right = Math.max(...p.nodes.map((n) => n.x + n.width));
  const top = Math.min(...p.nodes.map((n) => n.y));
  return { x: right + 60, y: top };
}
var PATCHABLE = ["x", "y", "width", "height", "title", "content", "prompt", "voice", "url", "status", "error", "model", "durationMs"];
function applyOp(p, op, created) {
  switch (op.op) {
    case "add_node": {
      if (!NODE_TYPES.includes(op.type)) throw new CanvasOpError(`\u672A\u77E5\u8282\u70B9\u7C7B\u578B\uFF1A${String(op.type)}`);
      const id = op.id !== void 0 && ID.test(op.id) && !p.nodes.some((n) => n.id === op.id) ? op.id : shortId("n");
      const [w, h] = DEFAULT_SIZE[op.type];
      const pos = nextPosition(p);
      const node = {
        id,
        type: op.type,
        x: op.x ?? pos.x,
        y: op.y ?? pos.y,
        width: op.width ?? w,
        height: op.height ?? h,
        status: op.status ?? (op.url !== void 0 ? "success" : "idle")
      };
      for (const key of ["title", "content", "prompt", "voice", "url", "model", "durationMs"]) {
        if (op[key] !== void 0) node[key] = op[key];
      }
      p.nodes.push(node);
      created.push(id);
      return;
    }
    case "update_node": {
      const node = findNode(p, op.id);
      for (const key of PATCHABLE) {
        if (op[key] !== void 0) node[key] = op[key];
      }
      return;
    }
    case "delete_node": {
      findNode(p, op.id);
      p.nodes = p.nodes.filter((n) => n.id !== op.id);
      p.edges = p.edges.filter((e) => e.source !== op.id && e.target !== op.id);
      return;
    }
    case "connect": {
      findNode(p, op.source);
      findNode(p, op.target);
      if (op.source === op.target) throw new CanvasOpError("\u4E0D\u80FD\u8FDE\u63A5\u8282\u70B9\u81EA\u8EAB");
      if (!p.edges.some((e) => e.source === op.source && e.target === op.target)) {
        const edge = { id: shortId("e"), source: op.source, target: op.target };
        p.edges.push(edge);
      }
      return;
    }
    case "disconnect": {
      p.edges = p.edges.filter((e) => !(e.source === op.source && e.target === op.target));
      return;
    }
    default:
      throw new CanvasOpError(`\u672A\u77E5\u64CD\u4F5C\uFF1A${JSON.stringify(op)}`);
  }
}

// mujing/canvas/src/host/jianying.ts
import { randomBytes } from "node:crypto";
import { copyFile, mkdir as mkdir2, writeFile as writeFile2 } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join as join2, resolve } from "node:path";
var MATERIALS_DIR = "materials";
function defaultJianyingDraftRoot(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === "win32") {
    const base = env.LOCALAPPDATA?.trim() || `${home}\\AppData\\Local`;
    return `${base.replace(/[\\/]+$/, "")}\\JianyingPro\\User Data\\Projects\\com.lveditor.draft`;
  }
  if (platform === "darwin") {
    return join2(home, "Movies", "JianyingPro", "User Data", "Projects", "com.lveditor.draft");
  }
  return join2(home, "JianyingPro", "Drafts");
}
var WINDOWS_ROOT = /^[A-Za-z]:[\\/]/;
var UNSAFE_NAME = /[\\/:*?"<>|\x00-\x1f]+/g;
function reservedWindowsName(name3) {
  const base = name3.split(".")[0]?.toUpperCase() ?? "";
  if (base === "CON" || base === "PRN" || base === "AUX" || base === "NUL") return true;
  return base.length === 4 && (base.startsWith("COM") || base.startsWith("LPT")) && base[3] >= "1" && base[3] <= "9";
}
function safeName(raw, fallback, limit = 80) {
  let name3 = raw.replace(UNSAFE_NAME, "-").trim().replace(/^[. -]+|[. -]+$/g, "");
  if (!name3) name3 = fallback;
  const chars = [...name3];
  if (chars.length > limit) name3 = chars.slice(0, limit).join("").trim().replace(/^[. -]+|[. -]+$/g, "");
  if (!name3) name3 = fallback;
  if (reservedWindowsName(name3)) name3 = `_${name3}`;
  return name3;
}
var BS = String.fromCharCode(92);
var UNC_PREFIX = BS + BS;
var FORBIDDEN_POSIX_PREFIXES = ["/etc", "/usr", "/bin", "/sbin", "/System", "/Library", "/private/etc", "/var/root", "/boot", "/proc", "/sys"];
var FORBIDDEN_WIN_PREFIXES = ["c:/windows", "c:/program files", "c:/program files (x86)", "c:/programdata"];
function isForbiddenSystemRoot(canonical, windows) {
  const lower = canonical.toLowerCase();
  if (windows) {
    return FORBIDDEN_WIN_PREFIXES.some((p) => lower === p || lower.startsWith(`${p}/`));
  }
  return FORBIDDEN_POSIX_PREFIXES.some((p) => {
    const lp = p.toLowerCase();
    return lower === lp || lower.startsWith(`${lp}/`);
  });
}
function normalizeDraftRoot(raw) {
  const root = raw.trim();
  if (!root) throw new CanvasOpError("\u8BF7\u586B\u5199\u526A\u6620\u8349\u7A3F\u76EE\u5F55\uFF08\u672C\u673A\u7EDD\u5BF9\u8DEF\u5F84\uFF09");
  if (root.includes("\u4F60\u7684\u7528\u6237\u540D")) throw new CanvasOpError("\u8BF7\u628A\u8DEF\u5F84\u91CC\u7684\u300C\u4F60\u7684\u7528\u6237\u540D\u300D\u6362\u6210\u7535\u8111\u4E0A\u7684\u5B9E\u9645\u7528\u6237\u540D");
  if ([...root].length > 400 || root.includes('"') || /[\x00-\x1f]/.test(root)) {
    throw new CanvasOpError("\u526A\u6620\u8349\u7A3F\u76EE\u5F55\u5305\u542B\u65E0\u6548\u5B57\u7B26");
  }
  const windows = WINDOWS_ROOT.test(root);
  const unc = root.startsWith(UNC_PREFIX) || root.startsWith("//");
  if (!windows && !unc && !root.startsWith("/")) {
    throw new CanvasOpError("\u526A\u6620\u8349\u7A3F\u76EE\u5F55\u5FC5\u987B\u662F macOS \u6216 Windows \u7684\u7EDD\u5BF9\u8DEF\u5F84");
  }
  const canonical = windows || unc ? root.replaceAll(BS, "/") : root;
  for (const part of canonical.split("/")) {
    if (part === "." || part === "..") throw new CanvasOpError("\u526A\u6620\u8349\u7A3F\u76EE\u5F55\u4E0D\u80FD\u5305\u542B . \u6216 .. \u8DEF\u5F84\u6BB5");
  }
  const trimmed = canonical.replace(/\/+$/, "");
  if (!trimmed || windows && trimmed.length <= 2) {
    throw new CanvasOpError("\u526A\u6620\u8349\u7A3F\u76EE\u5F55\u4E0D\u80FD\u662F\u78C1\u76D8\u6839\u76EE\u5F55");
  }
  if (isForbiddenSystemRoot(trimmed, windows)) {
    throw new CanvasOpError("\u526A\u6620\u8349\u7A3F\u76EE\u5F55\u4E0D\u80FD\u6307\u5411\u7CFB\u7EDF\u53D7\u4FDD\u62A4\u76EE\u5F55");
  }
  const allowedEnv = process.env.MUJING_ALLOWED_EXPORT_ROOTS?.trim();
  if (allowedEnv) {
    const allowedList = allowedEnv.split(",").map((s) => s.trim().replaceAll(BS, "/").replace(/\/+$/, "")).filter(Boolean);
    const lower = trimmed.toLowerCase();
    const ok = allowedList.some((a) => {
      const la = a.toLowerCase();
      return lower === la || lower.startsWith(`${la}/`);
    });
    if (!ok) throw new CanvasOpError("\u526A\u6620\u8349\u7A3F\u76EE\u5F55\u4E0D\u5728\u5141\u8BB8\u5BFC\u51FA\u7684\u8DEF\u5F84\u767D\u540D\u5355\u5185\uFF08MUJING_ALLOWED_EXPORT_ROOTS\uFF09");
  }
  return windows || unc ? trimmed.replaceAll("/", BS) : trimmed;
}
function newUpperUUID() {
  const raw = randomBytes(16);
  raw[6] = raw[6] & 15 | 64;
  raw[8] = raw[8] & 63 | 128;
  const hex = raw.toString("hex").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function timerange(start, duration) {
  return { start, duration };
}
function speedMaterial() {
  return { curve_speed: null, id: newUpperUUID(), mode: 0, speed: 1, type: "speed" };
}
function clipSettings(transformY) {
  return {
    alpha: 1,
    flip: { horizontal: false, vertical: false },
    rotation: 0,
    scale: { x: 1, y: 1 },
    transform: { x: 0, y: transformY }
  };
}
function baseSegment(materialId, start, duration, renderIndex, refs, clip) {
  return {
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    last_nonzero_volume: 1,
    reverse: false,
    track_attribute: 0,
    track_render_index: 0,
    visible: true,
    id: newUpperUUID(),
    material_id: materialId,
    target_timerange: timerange(start, duration),
    common_keyframes: [],
    keyframe_refs: [],
    speed: 1,
    volume: 1,
    extra_material_refs: refs,
    is_tone_modify: false,
    clip,
    uniform_scale: { on: true, value: 1 },
    render_index: renderIndex
  };
}
function subtitleMaterial(id, text) {
  const content = JSON.stringify({
    styles: [{
      fill: { alpha: 1, content: { render_type: "solid", solid: { alpha: 1, color: [1, 1, 1] } } },
      range: [0, [...text].length],
      size: 6,
      bold: false,
      italic: false,
      underline: false,
      strokes: [{ content: { solid: { alpha: 1, color: [0, 0, 0] } }, width: 0.08 }]
    }],
    text
  });
  return {
    id,
    content,
    typesetting: 0,
    alignment: 1,
    letter_spacing: 0,
    line_spacing: 0.02,
    line_feed: 1,
    line_max_width: 0.82,
    force_apply_line_max_width: false,
    check_flag: 15,
    type: "subtitle",
    global_alpha: 1
  };
}
function emptyMaterials() {
  const keys = [
    "ai_translates",
    "audio_balances",
    "audio_effects",
    "audio_fades",
    "audio_track_indexes",
    "audios",
    "beats",
    "canvases",
    "chromas",
    "color_curves",
    "digital_humans",
    "drafts",
    "effects",
    "flowers",
    "green_screens",
    "handwrites",
    "hsl",
    "images",
    "log_color_wheels",
    "loudnesses",
    "manual_deformations",
    "masks",
    "material_animations",
    "material_colors",
    "multi_language_refs",
    "placeholders",
    "plugin_effects",
    "primary_color_wheels",
    "realtime_denoises",
    "shapes",
    "smart_crops",
    "smart_relights",
    "sound_channel_mappings",
    "speeds",
    "stickers",
    "tail_leaders",
    "text_templates",
    "texts",
    "time_marks",
    "transitions",
    "video_effects",
    "video_trackings",
    "videos",
    "vocal_beautifys",
    "vocal_separations"
  ];
  return Object.fromEntries(keys.map((k) => [k, []]));
}
function buildJianyingDraftJson(input) {
  const root = normalizeDraftRoot(input.root);
  const draftName = safeName(input.name, "\u5E55\u5883\u6210\u7247\u8349\u7A3F", 100);
  if (input.clips.length === 0) throw new CanvasOpError("\u6CA1\u6709\u53EF\u5BFC\u51FA\u5230\u526A\u6620\u7684\u89C6\u9891\u7247\u6BB5");
  const sep2 = WINDOWS_ROOT.test(root) || root.startsWith(UNC_PREFIX) ? BS : "/";
  const folderPath = `${root}${sep2}${draftName}`;
  const materialPath = (fileName) => `${folderPath}${sep2}${MATERIALS_DIR}${sep2}${fileName}`;
  const draftId = newUpperUUID();
  const fps = input.fps && input.fps > 0 ? input.fps : 30;
  const nowSec = Math.floor(Date.now() / 1e3);
  const nowUs = Date.now() * 1e3;
  const materials = emptyMaterials();
  const videos = [];
  const speeds = [];
  const videoSegments = [];
  let cursorUs = 0;
  for (const clip of input.clips) {
    const durUs = Math.max(1e5, Math.round(clip.durationUs));
    const width = clip.width > 0 ? clip.width : input.width;
    const height = clip.height > 0 ? clip.height : input.height;
    const materialId = newUpperUUID();
    videos.push({
      audio_fade: null,
      category_id: "",
      category_name: "local",
      check_flag: 63487,
      crop: { upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0, lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1 },
      crop_ratio: "free",
      crop_scale: 1,
      duration: durUs,
      height,
      width,
      id: materialId,
      local_material_id: "",
      material_id: materialId,
      material_name: clip.name || clip.fileName,
      media_path: "",
      path: materialPath(clip.fileName),
      type: "video"
    });
    const spd = speedMaterial();
    speeds.push(spd);
    const seg = baseSegment(materialId, cursorUs, durUs, 0, [spd.id], clipSettings(0));
    seg.source_timerange = timerange(0, durUs);
    seg.hdr_settings = { intensity: 1, mode: 1, nits: 1e3 };
    videoSegments.push(seg);
    cursorUs += durUs;
  }
  const tracks = [{
    attribute: 0,
    flag: 0,
    id: newUpperUUID(),
    is_default_name: true,
    name: "",
    segments: videoSegments,
    type: "video"
  }];
  const audios = [];
  if (input.audios && input.audios.length > 0) {
    const audioSegments = [];
    for (const aud of input.audios) {
      if (aud.durationUs <= 0 || aud.startUs < 0 || aud.startUs >= cursorUs) continue;
      const durUs = Math.min(Math.max(1e5, Math.round(aud.durationUs)), Math.max(1e5, cursorUs - Math.round(aud.startUs)));
      const materialId = newUpperUUID();
      audios.push({
        app_id: 0,
        category_id: "",
        category_name: "local",
        check_flag: 1,
        duration: durUs,
        effect_id: "",
        formula_id: "",
        id: materialId,
        intensifies_path: "",
        local_material_id: "",
        music_id: materialId,
        name: aud.name || aud.fileName,
        path: materialPath(aud.fileName),
        query: "",
        request_id: "",
        resource_id: "",
        search_id: "",
        source_platform: 0,
        team_id: "",
        text_id: "",
        tone_category_id: "",
        tone_category_name: "",
        tone_effect_id: "",
        tone_effect_name: "",
        tone_speaker: "",
        tone_type: "",
        type: "extract_music",
        video_id: "",
        wave_points: []
      });
      const spd = speedMaterial();
      speeds.push(spd);
      const seg = baseSegment(materialId, Math.round(aud.startUs), durUs, 0, [spd.id], clipSettings(0));
      seg.source_timerange = timerange(0, durUs);
      seg.clip = null;
      audioSegments.push(seg);
    }
    if (audioSegments.length > 0) {
      tracks.push({
        attribute: 0,
        flag: 0,
        id: newUpperUUID(),
        is_default_name: false,
        name: "\u89D2\u8272\u914D\u97F3",
        segments: audioSegments,
        type: "audio"
      });
    }
  }
  const texts = [];
  if (input.captions.length > 0) {
    const textSegments = [];
    for (const cap of input.captions) {
      const text = cap.text.trim();
      if (!text || cap.durationUs <= 0 || cap.startUs < 0 || cap.startUs >= cursorUs) continue;
      const durUs = Math.min(Math.round(cap.durationUs), cursorUs - Math.round(cap.startUs));
      const materialId = newUpperUUID();
      texts.push(subtitleMaterial(materialId, text));
      const spd = speedMaterial();
      speeds.push(spd);
      const seg = baseSegment(materialId, Math.round(cap.startUs), durUs, 1, [spd.id], clipSettings(-0.8));
      seg.source_timerange = null;
      textSegments.push(seg);
    }
    if (textSegments.length > 0) {
      tracks.push({
        attribute: 0,
        flag: 0,
        id: newUpperUUID(),
        is_default_name: false,
        name: "\u53F0\u8BCD\u5B57\u5E55",
        segments: textSegments,
        type: "text"
      });
    }
  }
  materials.videos = videos;
  materials.audios = audios;
  materials.speeds = speeds;
  materials.texts = texts;
  const platform = { app_id: 3704, app_source: "lv", app_version: "5.9.0", os: sep2 === BS ? "windows" : "mac" };
  const content = {
    canvas_config: { height: input.height, ratio: "original", width: input.width },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      lyrics_recognition_id: "",
      lyrics_sync: true,
      lyrics_taskinfo: [],
      maintrack_adsorb: true,
      material_save_mode: 0,
      multi_language_current: "none",
      multi_language_list: [],
      multi_language_main: "none",
      multi_language_mode: "none",
      original_sound_last_index: 1,
      record_audio_last_index: 1,
      sticker_max_index: 1,
      subtitle_keywords_config: null,
      subtitle_recognition_id: "",
      subtitle_sync: true,
      subtitle_taskinfo: [],
      system_font_list: [],
      video_mute: false,
      zoom_info_params: null
    },
    cover: null,
    create_time: nowSec,
    duration: cursorUs,
    extra_info: null,
    fps,
    free_render_index_mode_on: false,
    group_container: null,
    id: draftId,
    keyframe_graph_list: [],
    keyframes: { adjusts: [], audios: [], effects: [], filters: [], handwrites: [], stickers: [], texts: [], videos: [] },
    last_modified_platform: platform,
    platform,
    materials,
    mutable_config: null,
    name: draftName,
    new_version: "110.0.0",
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: "default",
    static_cover_image_path: "",
    time_marks: null,
    tracks,
    update_time: nowSec,
    version: 36e4
  };
  const meta = {
    cloud_package_completed_time: "",
    draft_cloud_capcut_purchase_info: "",
    draft_cloud_last_action_download: false,
    draft_cloud_materials: [],
    draft_cloud_purchase_info: "",
    draft_cloud_template_id: "",
    draft_cloud_tutorial_info: "",
    draft_cloud_videocut_purchase_info: "",
    draft_cover: "",
    draft_deeplink_url: "",
    draft_enterprise_info: { draft_enterprise_extra: "", draft_enterprise_id: "", draft_enterprise_name: "", enterprise_material: [] },
    draft_fold_path: folderPath,
    draft_id: draftId,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_from_deeplink: "false",
    draft_is_invisible: false,
    draft_materials: [0, 1, 2, 3, 6, 7, 8].map((type) => ({ type, value: [] })),
    draft_materials_copied_info: [],
    draft_name: draftName,
    draft_new_version: "",
    draft_removable_storage_device: "",
    draft_root_path: root,
    draft_segment_extra_info: [],
    draft_type: "",
    tm_draft_cloud_completed: "",
    tm_draft_cloud_modified: 0,
    tm_draft_create: nowUs,
    tm_draft_modified: nowUs,
    tm_draft_removed: 0,
    tm_duration: cursorUs
  };
  return {
    folderPath,
    contentJson: JSON.stringify(content, null, 2),
    metaJson: JSON.stringify(meta, null, 2),
    srtText: buildSrt(input.captions)
  };
}
function isWritableLocalDraftPath(folderPath, platform = process.platform) {
  if (platform === "win32") {
    return WINDOWS_ROOT.test(folderPath) || folderPath.startsWith(UNC_PREFIX) || isAbsolute(folderPath);
  }
  return folderPath.startsWith("/");
}
async function writeJianyingDraftToDisk(input) {
  const built = buildJianyingDraftJson(input);
  if (!isWritableLocalDraftPath(built.folderPath)) {
    return {
      folderPath: built.folderPath,
      writtenToDisk: false,
      filesCount: 0,
      srtText: built.srtText,
      reason: `\u76EE\u6807\u8DEF\u5F84\u4E0E\u5F53\u524D\u670D\u52A1\u5668\u64CD\u4F5C\u7CFB\u7EDF\uFF08${process.platform}\uFF09\u4E0D\u5339\u914D\uFF0C\u672A\u80FD\u76F4\u63A5\u5199\u5165\u78C1\u76D8`
    };
  }
  const resolvedRoot = resolve(normalizeDraftRoot(input.root));
  const resolvedFolder = resolve(built.folderPath);
  const sep2 = process.platform === "win32" ? BS : "/";
  if (!resolvedFolder.startsWith(resolvedRoot + sep2)) {
    throw new CanvasOpError("\u8349\u7A3F\u843D\u76D8\u8DEF\u5F84\u8D8A\u754C\uFF0C\u5DF2\u62D2\u7EDD\u5199\u5165");
  }
  const materialsDir = join2(built.folderPath, MATERIALS_DIR);
  await mkdir2(materialsDir, { recursive: true });
  for (const clip of input.clips) {
    await copyFile(clip.sourceFile, join2(materialsDir, clip.fileName));
  }
  const audios = input.audios ?? [];
  for (const aud of audios) {
    await copyFile(aud.sourceFile, join2(materialsDir, aud.fileName));
  }
  await writeFile2(join2(built.folderPath, "draft_content.json"), built.contentJson, "utf8");
  await writeFile2(join2(built.folderPath, "draft_info.json"), built.contentJson, "utf8");
  await writeFile2(join2(built.folderPath, "draft_meta_info.json"), built.metaJson, "utf8");
  if (built.srtText) {
    await writeFile2(join2(built.folderPath, "subtitles.srt"), built.srtText, "utf8");
  }
  return {
    folderPath: built.folderPath,
    writtenToDisk: true,
    filesCount: input.clips.length + audios.length + 3 + (built.srtText ? 1 : 0),
    srtText: built.srtText
  };
}
function buildSrt(captions) {
  const nl = String.fromCharCode(10);
  const lines = [];
  let idx = 0;
  for (const cap of captions) {
    const text = cap.text.trim();
    if (!text || cap.durationUs <= 0 || cap.startUs < 0) continue;
    idx += 1;
    lines.push([String(idx), `${srtTime(cap.startUs)} --> ${srtTime(cap.startUs + cap.durationUs)}`, text, ""].join(nl));
  }
  return lines.join(nl);
}
function srtTime(us) {
  const ms = Math.max(0, Math.floor(us / 1e3));
  const h = String(Math.floor(ms / 36e5)).padStart(2, "0");
  const m = String(Math.floor(ms % 36e5 / 6e4)).padStart(2, "0");
  const s = String(Math.floor(ms % 6e4 / 1e3)).padStart(2, "0");
  const rem = String(ms % 1e3).padStart(3, "0");
  return `${h}:${m}:${s},${rem}`;
}

// mujing/canvas/src/host/drama.ts
var NL = String.fromCharCode(10);
var ORDINALS = ["\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u4E03", "\u516B", "\u4E5D", "\u5341", "\u5341\u4E00", "\u5341\u4E8C"];
var SHOT_LENS = {
  \u5927\u8FDC\u666F: "24mm\u5E7F\u89D2",
  \u8FDC\u666F: "28mm\u5E7F\u89D2",
  \u5168\u666F: "35mm\u955C\u5934",
  \u4E2D\u5168\u666F: "40mm\u955C\u5934",
  \u4E2D\u666F: "50mm\u6807\u51C6\u955C\u5934",
  \u4E2D\u8FD1\u666F: "65mm\u955C\u5934",
  \u8FD1\u666F: "85mm\u4EBA\u50CF\u955C\u5934",
  \u7279\u5199: "100mm\u7279\u5199\u955C\u5934",
  \u5927\u7279\u5199: "100mm\u5FAE\u8DDD\u7279\u5199"
};
function defaultDrama() {
  return {
    style: "\u7535\u5F71\u7EA7\u771F\u4EBA\u77ED\u5267\uFF0C\u7EC6\u817B\u81EA\u7136\u5149\u5F71\uFF0C8K\u8D28\u611F",
    aspectRatio: "9:16",
    language: "\u4E2D\u6587\u666E\u901A\u8BDD",
    segmentTargetSec: 8,
    casts: [],
    episodes: []
  };
}
function ensureDrama(p) {
  if (!p.drama) p.drama = defaultDrama();
  return p.drama;
}
function fmtSec(ms) {
  const sec = Math.max(0, ms / 1e3);
  return Number.isInteger(sec) ? String(sec) : sec.toFixed(1).replace(/\.0$/, "");
}
function buildEpisodeSegments(drama, episode, existing) {
  if (episode.shots.length === 0) return [];
  const maxMs = Math.max(3e3, Math.min(15e3, Math.round((drama.segmentTargetSec || 8) * 1e3)));
  const groups = [];
  const hasExplicitIndex = episode.shots.some((s, idx) => idx > 0 && s.segmentIndex > 0);
  if (hasExplicitIndex) {
    const byIdx = /* @__PURE__ */ new Map();
    for (const shot of episode.shots) {
      const k = Math.max(0, Math.floor(shot.segmentIndex || 0));
      const list = byIdx.get(k) ?? [];
      list.push(shot);
      byIdx.set(k, list);
    }
    for (const k of [...byIdx.keys()].sort((a, b) => a - b)) {
      const g = byIdx.get(k);
      if (g && g.length > 0) groups.push(g);
    }
  } else {
    let cur = [];
    let curMs = 0;
    for (const shot of episode.shots) {
      const dur = Math.max(1500, shot.durationMs || 3e3);
      const sceneChanged = cur.length > 0 && Boolean(shot.scene) && Boolean(cur[0].scene) && shot.scene !== cur[0].scene;
      if (cur.length > 0 && (curMs + dur > maxMs || sceneChanged || cur.length >= 4)) {
        groups.push(cur);
        cur = [];
        curMs = 0;
      }
      shot.segmentIndex = groups.length;
      cur.push(shot);
      curMs += dur;
    }
    if (cur.length > 0) groups.push(cur);
  }
  const prevByIndex = new Map((existing ?? []).map((s) => [s.index, s]));
  return groups.map((shots, index) => {
    for (const s of shots) s.segmentIndex = index;
    const prevSeg = prevByIndex.get(index);
    const prevShots = index > 0 ? groups[index - 1] : void 0;
    const handoff = prevSeg?.handoff ?? inferHandoff(prevShots, shots, index);
    const durationMs = shots.reduce((acc, s) => acc + Math.max(1500, s.durationMs || 3e3), 0);
    const prompt = compileSegmentPrompt({
      drama,
      episode,
      shots,
      index,
      totalCount: groups.length,
      handoff
    });
    return {
      id: prevSeg?.id ?? shortId("seg"),
      index,
      title: prevSeg?.title || `\u7B2C${episode.number}\u96C6\xB7\u7B2C${index + 1}\u6BB5\uFF08${shots.length}\u955C\uFF09`,
      handoff,
      durationMs,
      prompt,
      ...prevSeg?.videoNodeId ? { videoNodeId: prevSeg.videoNodeId } : {},
      ...prevSeg?.firstFrameUrl ? { firstFrameUrl: prevSeg.firstFrameUrl } : {},
      status: prevSeg?.status ?? "idle",
      ...prevSeg?.error ? { error: prevSeg.error } : {}
    };
  });
}
function inferHandoff(prevShots, curShots, index) {
  if (index === 0 || !prevShots || prevShots.length === 0) return "scene_cut";
  const lastPrev = prevShots[prevShots.length - 1];
  const firstCur = curShots[0];
  if (lastPrev.scene && firstCur.scene && lastPrev.scene !== firstCur.scene) return "scene_cut";
  if (lastPrev.speaker && firstCur.speaker && lastPrev.speaker !== firstCur.speaker) return "reverse_angle";
  return "continue";
}
function compileSegmentPrompt(input) {
  const { drama, episode, shots, index, totalCount, handoff } = input;
  const lines = [];
  lines.push(`\u3010${episode.title || `\u7B2C${episode.number}\u96C6`} \xB7 \u5267\u60C5\u6BB5 ${index + 1}/${totalCount}\u3011`);
  lines.push(`\u753B\u98CE\u4E0E\u89C6\u542C\u89C4\u8303\uFF1A${drama.style}\uFF1B\u753B\u5E45 ${drama.aspectRatio}\u3002`);
  const scenes = [...new Set(shots.map((s) => s.scene.trim()).filter(Boolean))];
  if (scenes.length > 0) lines.push(`\u7A7A\u95F4\u9501\u5B9A\uFF1A${scenes.join("\uFF1B")}\u3002`);
  lines.push("\u5207\u955C\u4FDD\u6301\u8F74\u7EBF\u4E0E\u753B\u9762\u5DE6\u53F3\u5173\u7CFB\uFF0C\u4E0D\u8D8A\u8F74\uFF0C\u4E0D\u7A7F\u6A21\uFF1B\u4EBA\u7269\u6309\u5267\u60C5\u81EA\u7136\u8D70\u4F4D\u3002");
  if (index > 0) {
    if (handoff === "continue") {
      lines.push("\u63A5\u7EED\u5173\u7CFB\uFF1A\u672C\u6BB5\u4EE5\u4F20\u5165\u7684\u9996\u5E27\u56FE\uFF08\u4E0A\u4E00\u6BB5\u771F\u5B9E\u5C3E\u5E27\uFF09\u65E0\u7F1D\u8D77\u5E45\uFF0C\u7D27\u63A5\u4E0A\u4E00\u955C\u52A8\u4F5C\u7EE7\u7EED\u8868\u6F14\uFF0C\u7981\u6B62\u91CD\u590D\u4E0A\u4E00\u955C\u5DF2\u5B8C\u6210\u7684\u52A8\u4F5C\u3002");
    } else if (handoff === "reverse_angle") {
      lines.push("\u63A5\u7EED\u5173\u7CFB\uFF1A\u540C\u573A\u6362\u673A\u4F4D/\u6B63\u53CD\u6253\u5207\u955C\uFF0C\u4FDD\u6301\u573A\u666F\u5149\u7EBF\u4E0E\u4EBA\u7269\u7AD9\u4F4D\u4E00\u81F4\uFF0C\u65B0\u673A\u4F4D\u5E72\u51C0\u5207\u5165\u3002");
    } else {
      lines.push("\u63A5\u7EED\u5173\u7CFB\uFF1A\u65B0\u573A\u6B21\u72EC\u7ACB\u5F00\u62CD\uFF0C\u6309\u9996\u955C\u753B\u9762\u8BBE\u5B9A\u76F4\u63A5\u8D77\u5E45\u3002");
    }
  }
  const activeCastIds = /* @__PURE__ */ new Set();
  for (const shot of shots) {
    for (const cid of shot.castIds ?? []) activeCastIds.add(cid);
    for (const c of drama.casts) {
      if (shot.speaker === c.name || shot.action.includes(c.name) || shot.scene.includes(c.name)) {
        activeCastIds.add(c.id);
      }
    }
  }
  const activeCasts = drama.casts.filter((c) => activeCastIds.has(c.id));
  const chars = activeCasts.filter((c) => c.kind === "character");
  const propsAndScenes = activeCasts.filter((c) => c.kind !== "character");
  if (chars.length > 0) {
    lines.push("");
    lines.push("\u3010\u51FA\u573A\u89D2\u8272\u9501\u5B9A\u3011");
    chars.forEach((c, idx) => {
      const refTag = c.imageUrl || c.imageNodeId ? `\uFF08\u53C2\u8003\u56FE${idx + 1}\uFF09` : "";
      lines.push(`- ${c.name}${refTag}\uFF1A${c.appearance}\u3002\u5916\u8C8C\u3001\u670D\u88C5\u4E0E\u53D1\u578B\u4E25\u683C\u4FDD\u6301\u4E00\u81F4\u3002`);
    });
  }
  if (propsAndScenes.length > 0) {
    lines.push("");
    lines.push("\u3010\u573A\u666F\u4E0E\u5173\u952E\u9053\u5177\u3011");
    for (const item of propsAndScenes) {
      lines.push(`- ${item.name}\uFF08${item.kind === "scene" ? "\u573A\u666F" : "\u9053\u5177"}\uFF09\uFF1A${item.appearance}\u3002`);
    }
  }
  lines.push("");
  lines.push("\u3010\u5149\u6E90\u4E0E\u58F0\u97F3\u3011");
  lines.push(`\u5149\u7EBF\u65B9\u5411\u4E0E\u8272\u6E29\u5728\u672C\u6BB5\u5185\u4FDD\u6301\u8FDE\u7EED\u3002\u5BF9\u767D\u4F7F\u7528${drama.language || "\u4E2D\u6587\u666E\u901A\u8BDD"}\uFF0C\u53E3\u578B\u4E0E\u53F0\u8BCD\u540C\u6B65\uFF0C\u73AF\u5883\u97F3\u968F\u753B\u9762\u52A8\u4F5C\u3002`);
  for (const c of chars) {
    if (c.voice?.trim()) lines.push(`- ${c.name}\u97F3\u8272\uFF1A${c.voice.trim()}`);
  }
  let cursorMs = 0;
  shots.forEach((shot, sIdx) => {
    const dur = Math.max(1500, shot.durationMs || 3e3);
    const start = cursorMs;
    const end = cursorMs + dur;
    cursorMs = end;
    const ord = ORDINALS[sIdx] ?? String(sIdx + 1);
    const cam = shot.camera?.trim() || "\u56FA\u5B9A";
    const size = shot.shotSize?.trim() || "\u4E2D\u666F";
    const head = cam !== "\u56FA\u5B9A" ? `${size}\xB7${cam}` : size;
    lines.push("");
    lines.push(`\u3010${fmtSec(start)}\u2014${fmtSec(end)}\u79D2\uFF5C\u955C\u5934${ord}\uFF1A${head}\u3011`);
    const lens = SHOT_LENS[size] ? `${SHOT_LENS[size]}\uFF0C${size}` : size;
    lines.push(`${lens}${cam !== "\u56FA\u5B9A" ? `\uFF0C\u8FD0\u955C\uFF1A${cam}` : ""}\u3002`);
    if (sIdx > 0 && shot.transition === "fadeblack") lines.push("\u672C\u955C\u4ECE\u9ED1\u573A\u6DE1\u5165\u3002");
    if (sIdx > 0 && shot.transition === "fadewhite") lines.push("\u672C\u955C\u4EE5\u77ED\u6682\u95EA\u767D\u5207\u5165\u3002");
    if (shot.imagePrompt?.trim()) lines.push(`\u8D77\u5E45\u753B\u9762\uFF1A${shot.imagePrompt.trim()}`);
    if (shot.action?.trim()) lines.push(`\u52A8\u4F5C\u8868\u6F14\uFF1A${shot.action.trim()}`);
    if (shot.videoPrompt?.trim() && shot.videoPrompt.trim() !== shot.action?.trim()) {
      lines.push(shot.videoPrompt.trim());
    }
    if (shot.dialogue?.trim()) {
      const spk = shot.speaker?.trim() || "\u65C1\u767D\uFF08\u753B\u5916\u97F3\uFF09";
      lines.push(`${spk}\uFF1A\u201C${shot.dialogue.trim()}\u201D`);
      if (dur >= 2e3) lines.push("\u53F0\u8BCD\u6E05\u6670\u81EA\u7136\uFF0C\u8BF4\u5B8C\u75590.3\u79D2\u6C14\u53E3\u3002");
    } else {
      lines.push("\u65E0\u53F0\u8BCD\u3002");
    }
    if (sIdx === shots.length - 1 && index < totalCount - 1) {
      lines.push(`\u672B0.4\u79D2\u52A8\u4F5C\u6536\u4F4F\u3001\u955C\u5934\u505C\u7A33\uFF0C\u4EBA\u7269\u4FDD\u7559\u547C\u5438\u4E0E\u773C\u795E\u5FAE\u52A8\u6001\uFF0C\u4F5C\u4E3A\u7B2C${index + 2}\u6BB5\u7684\u63A5\u7EED\u57FA\u51C6\u3002`);
    }
  });
  return lines.join(NL);
}
function collectShotCastRefs(project, shots) {
  const drama = project.drama;
  if (!drama) return [];
  const activeIds = /* @__PURE__ */ new Set();
  for (const shot of shots) {
    for (const cid of shot.castIds ?? []) activeIds.add(cid);
    for (const c of drama.casts) {
      if (shot.speaker === c.name || shot.action.includes(c.name) || shot.scene.includes(c.name)) activeIds.add(c.id);
    }
  }
  const urls = [];
  for (const c of drama.casts) {
    if (!activeIds.has(c.id)) continue;
    const nodeUrl = c.imageNodeId ? project.nodes.find((n) => n.id === c.imageNodeId)?.url : void 0;
    const url = nodeUrl || c.imageUrl;
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}
function collectSegmentCastRefs(project, episode, segment) {
  const shots = episode.shots.filter((s) => s.segmentIndex === segment.index);
  return collectShotCastRefs(project, shots);
}
function compileShotKeyframePrompt(drama, shot) {
  if (shot.imagePrompt?.trim()) return `${shot.imagePrompt.trim()}\uFF0C${drama.style}`;
  const size = shot.shotSize?.trim() || "\u4E2D\u666F";
  const lens = SHOT_LENS[size] ? `${SHOT_LENS[size]}\uFF0C${size}` : size;
  const matchedCasts = drama.casts.filter(
    (c) => (shot.castIds ?? []).includes(c.id) || shot.speaker === c.name || shot.action.includes(c.name) || shot.scene.includes(c.name)
  );
  const castDesc = matchedCasts.map((c) => `${c.name}\uFF08${c.appearance}\uFF09`).join("\uFF1B");
  return [
    `\u7535\u5F71\u6545\u4E8B\u677F\u5173\u952E\u5E27\uFF0C${drama.style}\uFF0C\u753B\u5E45 ${drama.aspectRatio}`,
    `\u573A\u666F\uFF1A${shot.scene}`,
    `\u666F\u522B\u4E0E\u955C\u5934\uFF1A${lens}${shot.camera && shot.camera !== "\u56FA\u5B9A" ? `\uFF0C${shot.camera}\u6784\u56FE` : ""}`,
    castDesc ? `\u51FA\u573A\u89D2\u8272\u8BBE\u5B9A\uFF1A${castDesc}` : "",
    `\u753B\u9762\u77AC\u95F4\uFF1A${shot.action}`
  ].filter(Boolean).join("\uFF1B");
}
function buildEpisodeCaptions(episode) {
  const captions = [];
  let cursorUs = 0;
  for (const shot of episode.shots) {
    const durUs = Math.max(1500, shot.durationMs || 3e3) * 1e3;
    const dlg = shot.dialogue?.trim();
    if (dlg) {
      const spk = shot.speaker?.trim();
      const label = spk && spk !== "\u65C1\u767D" ? `${spk}\uFF1A${dlg}` : dlg;
      captions.push({ text: label, startUs: cursorUs + 1e5, durationUs: Math.max(5e5, durUs - 25e4) });
    }
    cursorUs += durUs;
  }
  return { captions, srt: buildSrt(captions) };
}
function formatEpisodeMarkdown(ep) {
  const lines = [`# \u7B2C${ep.number}\u96C6\uFF1A${ep.title}`, ""];
  if (ep.hook) lines.push(`> **\u5F00\u573A\u94A9\u5B50**\uFF1A${ep.hook}`);
  if (ep.synopsis) lines.push(`> **\u672C\u96C6\u6897\u6982**\uFF1A${ep.synopsis}`);
  if (ep.cliffhanger) lines.push(`> **\u96C6\u5C3E\u60AC\u5FF5**\uFF1A${ep.cliffhanger}`);
  lines.push("", "## \u5206\u955C\u8868", "");
  ep.shots.forEach((s, i) => {
    const dlg = s.dialogue ? ` \uFF5C **${s.speaker || "\u65C1\u767D"}**\uFF1A\u300C${s.dialogue}\u300D` : "";
    lines.push(`${i + 1}. **[\u6BB5${s.segmentIndex + 1} \xB7 ${s.shotSize} \xB7 ${s.camera} \xB7 ${(s.durationMs / 1e3).toFixed(1)}s]** \uFF08${s.scene}\uFF09${s.action}${dlg}`);
  });
  return lines.join(NL);
}

// mujing/canvas/src/host/media.ts
import { execFile, execFileSync } from "node:child_process";
import { randomUUID as randomUUID2 } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir as mkdir3, readFile as readFile2, rename as rename2, rm as rm2, writeFile as writeFile3 } from "node:fs/promises";
import { isIP } from "node:net";
import { extname, join as join3, resolve as resolve2, sep } from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
function resolveWorkingBinary(envVars, defaultCmd, fallbacks) {
  const candidates = [...envVars.map((k) => process.env[k]), defaultCmd, ...fallbacks].filter((x) => Boolean(x));
  for (const bin of candidates) {
    try {
      execFileSync(bin, ["-version"], { stdio: "ignore", timeout: 3e3 });
      return bin;
    } catch {
    }
  }
  return defaultCmd;
}
var FFMPEG_BIN = resolveWorkingBinary(["MUJING_FFMPEG_BIN", "FFMPEG_PATH"], "ffmpeg", [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg"
]);
var FFPROBE_BIN = resolveWorkingBinary(["MUJING_FFPROBE_BIN", "FFPROBE_PATH"], "ffprobe", [
  "/opt/homebrew/bin/ffprobe",
  "/usr/local/bin/ffprobe"
]);
var COOLDOWN_BASE_MS = 15e3;
var COOLDOWN_MAX_MS = 6e4;
function normalizeStrategy(v, fallback = "round_robin") {
  return v === "round_robin" || v === "failover" || v === "random" ? v : fallback;
}
function clampWeight(v, fallback = 1) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(10, Math.round(n)));
}
function makeEndpointId(kind) {
  return `${kind}-${randomUUID2().slice(0, 8)}`;
}
function maskApiKey(key) {
  const s = key.trim();
  if (!s) return "";
  if (s.length <= 6) return "\u2022\u2022\u2022\u2022";
  if (s.length <= 10) return `${s.slice(0, 2)}\u2022\u2022\u2022\u2022${s.slice(-2)}`;
  return `${s.slice(0, 4)}\u2022\u2022\u2022\u2022${s.slice(-4)}`;
}
function buildInterleavedSlots(items) {
  if (items.length <= 1) return [...items];
  const counts = items.map((it) => clampWeight(it.weight, 1));
  const total = counts.reduce((a, b) => a + b, 0);
  const current = items.map(() => 0);
  const slots = [];
  for (let i = 0; i < total; i++) {
    let bestIdx = 0;
    for (let j = 0; j < items.length; j++) {
      current[j] += counts[j];
      if (current[j] > current[bestIdx]) bestIdx = j;
    }
    current[bestIdx] -= total;
    slots.push(items[bestIdx]);
  }
  return slots;
}
function isAbortError(error, signal) {
  if (signal?.aborted) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return error instanceof Error && error.name === "AbortError";
}
var MediaConfigError = class extends Error {
  code = "MUJING_MEDIA_NOT_CONFIGURED";
};
var MediaUpstreamError = class extends Error {
  code = "MUJING_MEDIA_UPSTREAM";
};
var MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".srt": "text/plain; charset=utf-8"
};
function mimeOf(file) {
  return MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
}
function extFromMime(mime, fallback) {
  const clean = mime?.split(";")[0]?.trim().toLowerCase() ?? null;
  const hit = Object.entries(MIME).find(([, m]) => clean !== null && m.split(";")[0] === clean);
  return hit?.[0] ?? fallback;
}
var DEFAULT_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
var DEFAULT_MAX_REF_BYTES = 30 * 1024 * 1024;
var BLOCKED_METADATA_HOSTS = /* @__PURE__ */ new Set([
  "169.254.169.254",
  "169.254.170.2",
  "metadata.google.internal",
  "metadata.goog",
  "fd00:ec2::254",
  "0.0.0.0",
  "::"
]);
function maxDownloadBytes(fallback = DEFAULT_MAX_DOWNLOAD_BYTES) {
  const raw = Number(process.env.MUJING_MAX_DOWNLOAD_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}
function stripIpv6Brackets(host) {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}
function isPrivateOrReservedIp(rawIp) {
  const ip = stripIpv6Brackets(rawIp).toLowerCase();
  const mapped = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const ver = isIP(mapped);
  if (ver === 4) {
    const [a, b] = mapped.split(".").map((n) => Number.parseInt(n, 10));
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (isIP(ip) === 6) {
    if (ip === "::" || ip === "::1") return true;
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
    if (/^fe[89ab]/i.test(ip)) return true;
    return false;
  }
  return false;
}
function validateEndpointBaseUrl(rawUrl) {
  const trimmed = rawUrl.trim();
  if (!trimmed) return;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new MediaConfigError(`\u63A5\u53E3\u5730\u5740\u683C\u5F0F\u65E0\u6548\uFF1A${trimmed}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MediaConfigError(`\u63A5\u53E3\u5730\u5740\u4EC5\u652F\u6301 http/https \u534F\u8BAE\uFF1A${parsed.protocol}`);
  }
  const host = stripIpv6Brackets(parsed.hostname).toLowerCase();
  if (BLOCKED_METADATA_HOSTS.has(host)) {
    throw new MediaConfigError(`\u7981\u6B62\u5C06\u4E91\u5143\u6570\u636E\u6216\u4FDD\u7559\u5730\u5740\u914D\u7F6E\u4E3A\u5A92\u4F53\u7AEF\u70B9\uFF1A${host}`);
  }
}
async function assertSafeRemoteUrl(rawUrl, opts) {
  const label = opts?.label ?? "\u8FDC\u7A0B\u8D44\u6E90";
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new MediaUpstreamError(`${label}\u5730\u5740\u683C\u5F0F\u65E0\u6548`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MediaUpstreamError(`${label}\u4EC5\u5141\u8BB8 http/https \u534F\u8BAE\uFF08\u62D2\u7EDD ${parsed.protocol}\uFF09`);
  }
  const host = stripIpv6Brackets(parsed.hostname).toLowerCase();
  if (!host || BLOCKED_METADATA_HOSTS.has(host)) {
    throw new MediaUpstreamError(`${label}\u5730\u5740\u88AB\u5B89\u5168\u7B56\u7565\u62D2\u7EDD\uFF1A${host || rawUrl}`);
  }
  const allowPrivate = Boolean(opts?.allowPrivate) || process.env.MUJING_ALLOW_PRIVATE_URLS === "1" || process.env.MUJING_ALLOW_PRIVATE_URLS === "true" || Boolean(opts?.allowedOrigins?.has(parsed.origin));
  if (allowPrivate) return parsed;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new MediaUpstreamError(`${label}\u4E0D\u5141\u8BB8\u8BBF\u95EE\u672C\u673A\u6216\u5185\u7F51\u57DF\u540D\uFF1A${host}`);
  }
  if (isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host)) {
      throw new MediaUpstreamError(`${label}\u4E0D\u5141\u8BB8\u8BBF\u95EE\u5185\u7F51\u6216\u56DE\u73AF\u5730\u5740\uFF1A${host}`);
    }
    return parsed;
  }
  try {
    const resolved = await lookup(host, { all: true });
    for (const entry of resolved) {
      const addr = entry.address.toLowerCase();
      if (BLOCKED_METADATA_HOSTS.has(addr) || isPrivateOrReservedIp(addr)) {
        throw new MediaUpstreamError(`${label}\u57DF\u540D\u89E3\u6790\u5230\u53D7\u9650\u5185\u7F51\u5730\u5740\uFF1A${host} -> ${addr}`);
      }
    }
  } catch (error) {
    if (error instanceof MediaUpstreamError) throw error;
  }
  return parsed;
}
async function readResponseBytesWithLimit(res, limitBytes, label = "\u4E0B\u8F7D\u5185\u5BB9") {
  const cl = Number(res.headers.get("content-length"));
  if (Number.isFinite(cl) && cl > limitBytes) {
    await res.body?.cancel().catch(() => {
    });
    throw new MediaUpstreamError(`${label}\u4F53\u79EF\u8D85\u9650\uFF08${cl} > ${limitBytes} \u5B57\u8282\uFF09`);
  }
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > limitBytes) {
      throw new MediaUpstreamError(`${label}\u4F53\u79EF\u8D85\u9650\uFF08${buf.byteLength} > ${limitBytes} \u5B57\u8282\uFF09`);
    }
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel().catch(() => {
        });
        throw new MediaUpstreamError(`${label}\u4F53\u79EF\u8D85\u9650\uFF08\u8D85\u8FC7 ${limitBytes} \u5B57\u8282\u4E0A\u9650\uFF09`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
var ASSET_PREFIX = "/mujing/assets/";
var MediaService = class {
  assetsDir;
  dataDir;
  configFile;
  defaults;
  imagePool;
  videoPool;
  audioPool;
  health = /* @__PURE__ */ new Map();
  constructor(dataDir, image, video, audio) {
    this.dataDir = dataDir;
    this.assetsDir = join3(dataDir, "assets");
    this.configFile = join3(dataDir, "media-config.json");
    this.defaults = {
      image: { ...image },
      video: { ...video },
      audio: { ...audio }
    };
    this.imagePool = this.makeDefaultImagePool();
    this.videoPool = this.makeDefaultVideoPool();
    this.audioPool = this.makeDefaultAudioPool();
    this.loadSavedConfigSync();
  }
  makeDefaultImagePool() {
    return {
      strategy: "round_robin",
      autoFailover: true,
      cursor: 0,
      endpoints: [{
        ...this.defaults.image,
        id: "default-image",
        name: "\u9ED8\u8BA4\u751F\u56FE\u63A5\u53E3",
        enabled: true,
        weight: 1
      }]
    };
  }
  makeDefaultVideoPool() {
    return {
      strategy: "round_robin",
      autoFailover: true,
      cursor: 0,
      endpoints: [{
        ...this.defaults.video,
        id: "default-video",
        name: "\u9ED8\u8BA4\u89C6\u9891\u63A5\u53E3",
        enabled: true,
        weight: 1
      }]
    };
  }
  makeDefaultAudioPool() {
    return {
      strategy: "round_robin",
      autoFailover: true,
      cursor: 0,
      endpoints: [{
        ...this.defaults.audio,
        id: "default-audio",
        name: "\u9ED8\u8BA4\u914D\u97F3\u63A5\u53E3",
        enabled: true,
        weight: 1
      }]
    };
  }
  normalizeImageEndpoint(raw, index) {
    return {
      id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : makeEndpointId("image"),
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `\u751F\u56FE\u63A5\u53E3 #${index + 1}`,
      enabled: raw.enabled !== false,
      weight: clampWeight(raw.weight, 1),
      baseURL: typeof raw.baseURL === "string" ? raw.baseURL.trim() : this.defaults.image.baseURL ?? "",
      ...typeof raw.apiKey === "string" && raw.apiKey.trim() ? { apiKey: raw.apiKey.trim() } : {},
      apiKeyEnv: typeof raw.apiKeyEnv === "string" ? raw.apiKeyEnv.trim() : this.defaults.image.apiKeyEnv,
      model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : this.defaults.image.model,
      size: typeof raw.size === "string" && raw.size.trim() ? raw.size.trim() : this.defaults.image.size,
      flavor: raw.flavor === "openai" || raw.flavor === "ark" ? raw.flavor : this.defaults.image.flavor
    };
  }
  normalizeVideoEndpoint(raw, index) {
    const dur = typeof raw.duration === "number" && Number.isFinite(raw.duration) && raw.duration >= 2 && raw.duration <= 20 ? Math.round(raw.duration) : this.defaults.video.duration;
    return {
      id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : makeEndpointId("video"),
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `\u89C6\u9891\u63A5\u53E3 #${index + 1}`,
      enabled: raw.enabled !== false,
      weight: clampWeight(raw.weight, 1),
      baseURL: typeof raw.baseURL === "string" ? raw.baseURL.trim() : this.defaults.video.baseURL ?? "",
      ...typeof raw.apiKey === "string" && raw.apiKey.trim() ? { apiKey: raw.apiKey.trim() } : {},
      apiKeyEnv: typeof raw.apiKeyEnv === "string" ? raw.apiKeyEnv.trim() : this.defaults.video.apiKeyEnv,
      model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : this.defaults.video.model,
      flavor: raw.flavor === "openai" || raw.flavor === "ark" ? raw.flavor : this.defaults.video.flavor,
      duration: dur,
      ratio: typeof raw.ratio === "string" && raw.ratio.trim() ? raw.ratio.trim() : this.defaults.video.ratio,
      pollIntervalMs: this.defaults.video.pollIntervalMs,
      timeoutMs: this.defaults.video.timeoutMs
    };
  }
  normalizeAudioEndpoint(raw, index) {
    return {
      id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : makeEndpointId("audio"),
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `\u914D\u97F3\u63A5\u53E3 #${index + 1}`,
      enabled: raw.enabled !== false,
      weight: clampWeight(raw.weight, 1),
      baseURL: typeof raw.baseURL === "string" ? raw.baseURL.trim() : this.defaults.audio.baseURL ?? "",
      ...typeof raw.apiKey === "string" && raw.apiKey.trim() ? { apiKey: raw.apiKey.trim() } : {},
      apiKeyEnv: typeof raw.apiKeyEnv === "string" ? raw.apiKeyEnv.trim() : this.defaults.audio.apiKeyEnv,
      model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : this.defaults.audio.model,
      voice: typeof raw.voice === "string" && raw.voice.trim() ? raw.voice.trim() : this.defaults.audio.voice,
      format: raw.format === "mp3" || raw.format === "wav" ? raw.format : this.defaults.audio.format
    };
  }
  loadSavedConfigSync() {
    try {
      if (!existsSync(this.configFile)) return;
      const raw = JSON.parse(readFileSync(this.configFile, "utf8"));
      if (raw.image && typeof raw.image === "object") {
        if ("endpoints" in raw.image && Array.isArray(raw.image.endpoints)) {
          const pool = raw.image;
          this.imagePool = {
            strategy: normalizeStrategy(pool.strategy),
            autoFailover: pool.autoFailover !== false,
            cursor: 0,
            endpoints: (pool.endpoints ?? []).map((ep, i) => this.normalizeImageEndpoint(ep, i))
          };
        } else {
          this.imagePool = {
            strategy: "round_robin",
            autoFailover: true,
            cursor: 0,
            endpoints: [this.normalizeImageEndpoint({ id: "default-image", name: "\u9ED8\u8BA4\u751F\u56FE\u63A5\u53E3", ...raw.image }, 0)]
          };
        }
      }
      if (raw.video && typeof raw.video === "object") {
        if ("endpoints" in raw.video && Array.isArray(raw.video.endpoints)) {
          const pool = raw.video;
          this.videoPool = {
            strategy: normalizeStrategy(pool.strategy),
            autoFailover: pool.autoFailover !== false,
            cursor: 0,
            endpoints: (pool.endpoints ?? []).map((ep, i) => this.normalizeVideoEndpoint(ep, i))
          };
        } else {
          this.videoPool = {
            strategy: "round_robin",
            autoFailover: true,
            cursor: 0,
            endpoints: [this.normalizeVideoEndpoint({ id: "default-video", name: "\u9ED8\u8BA4\u89C6\u9891\u63A5\u53E3", ...raw.video }, 0)]
          };
        }
      }
      if (raw.audio && typeof raw.audio === "object") {
        if ("endpoints" in raw.audio && Array.isArray(raw.audio.endpoints)) {
          const pool = raw.audio;
          this.audioPool = {
            strategy: normalizeStrategy(pool.strategy),
            autoFailover: pool.autoFailover !== false,
            cursor: 0,
            endpoints: (pool.endpoints ?? []).map((ep, i) => this.normalizeAudioEndpoint(ep, i))
          };
        } else {
          this.audioPool = {
            strategy: "round_robin",
            autoFailover: true,
            cursor: 0,
            endpoints: [this.normalizeAudioEndpoint({ id: "default-audio", name: "\u9ED8\u8BA4\u914D\u97F3\u63A5\u53E3", ...raw.audio }, 0)]
          };
        }
      }
    } catch {
    }
  }
  async persistConfig() {
    await mkdir3(this.dataDir, { recursive: true });
    const payload = {
      version: 2,
      image: {
        strategy: this.imagePool.strategy,
        autoFailover: this.imagePool.autoFailover,
        endpoints: this.imagePool.endpoints.map((ep) => ({
          id: ep.id,
          name: ep.name,
          enabled: ep.enabled,
          weight: ep.weight,
          baseURL: ep.baseURL ?? "",
          ...ep.apiKey ? { apiKey: ep.apiKey } : {},
          apiKeyEnv: ep.apiKeyEnv,
          model: ep.model,
          size: ep.size,
          flavor: ep.flavor
        }))
      },
      video: {
        strategy: this.videoPool.strategy,
        autoFailover: this.videoPool.autoFailover,
        endpoints: this.videoPool.endpoints.map((ep) => ({
          id: ep.id,
          name: ep.name,
          enabled: ep.enabled,
          weight: ep.weight,
          baseURL: ep.baseURL ?? "",
          ...ep.apiKey ? { apiKey: ep.apiKey } : {},
          apiKeyEnv: ep.apiKeyEnv,
          model: ep.model,
          flavor: ep.flavor,
          duration: ep.duration,
          ratio: ep.ratio
        }))
      },
      audio: {
        strategy: this.audioPool.strategy,
        autoFailover: this.audioPool.autoFailover,
        endpoints: this.audioPool.endpoints.map((ep) => ({
          id: ep.id,
          name: ep.name,
          enabled: ep.enabled,
          weight: ep.weight,
          baseURL: ep.baseURL ?? "",
          ...ep.apiKey ? { apiKey: ep.apiKey } : {},
          apiKeyEnv: ep.apiKeyEnv,
          model: ep.model,
          voice: ep.voice,
          format: ep.format
        }))
      }
    };
    const tmpFile = `${this.configFile}.${process.pid}.${randomUUID2().slice(0, 8)}.tmp`;
    await writeFile3(tmpFile, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 384 });
    await rename2(tmpFile, this.configFile);
    await chmod(this.configFile, 384).catch(() => {
    });
  }
  getHealth(id) {
    let h = this.health.get(id);
    if (!h) {
      h = { totalRequests: 0, successCount: 0, failCount: 0, consecutiveFails: 0 };
      this.health.set(id, h);
    }
    return h;
  }
  recordSuccess(id) {
    const h = this.getHealth(id);
    h.totalRequests += 1;
    h.successCount += 1;
    h.consecutiveFails = 0;
    h.lastUsedAt = Date.now();
    delete h.lastError;
    delete h.cooldownUntil;
  }
  recordFailure(id, error) {
    const h = this.getHealth(id);
    h.totalRequests += 1;
    h.failCount += 1;
    h.consecutiveFails += 1;
    h.lastUsedAt = Date.now();
    h.lastError = error instanceof Error ? error.message : String(error);
    const cooldownMs = Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * Math.min(4, h.consecutiveFails));
    h.cooldownUntil = Date.now() + cooldownMs;
  }
  resolveKey(c) {
    const custom = c.apiKey?.trim() ?? "";
    if (custom) return { key: custom, source: "custom" };
    const envName = c.apiKeyEnv?.trim() ?? "";
    const envVal = envName ? process.env[envName]?.trim() ?? "" : "";
    if (envVal) return { key: envVal, source: "env" };
    return { key: "", source: "none" };
  }
  endpointReady(c) {
    return c.enabled && Boolean(c.baseURL?.trim()) && Boolean(this.resolveKey(c).key);
  }
  endpointConfigured(c) {
    return Boolean(c.baseURL?.trim()) && Boolean(this.resolveKey(c).key);
  }
  toEndpointBaseDetail(ep) {
    const resolved = this.resolveKey(ep);
    const h = this.health.get(ep.id);
    const now = Date.now();
    const remaining = h?.cooldownUntil && h.cooldownUntil > now ? h.cooldownUntil - now : 0;
    return {
      id: ep.id,
      name: ep.name,
      enabled: ep.enabled,
      weight: ep.weight,
      ready: this.endpointConfigured(ep),
      baseURL: ep.baseURL ?? "",
      model: ep.model,
      apiKeyEnv: ep.apiKeyEnv,
      hasApiKey: Boolean(resolved.key),
      apiKeySource: resolved.source,
      apiKeyMasked: maskApiKey(resolved.key),
      totalRequests: h?.totalRequests ?? 0,
      successCount: h?.successCount ?? 0,
      failCount: h?.failCount ?? 0,
      consecutiveFails: h?.consecutiveFails ?? 0,
      inCooldown: remaining > 0,
      cooldownRemainingMs: remaining,
      ...h?.lastUsedAt ? { lastUsedAt: h.lastUsedAt } : {},
      ...h?.lastError ? { lastError: h.lastError } : {}
    };
  }
  status() {
    const imgReady = this.imagePool.endpoints.filter((ep) => this.endpointReady(ep));
    const vidReady = this.videoPool.endpoints.filter((ep) => this.endpointReady(ep));
    const audReady = this.audioPool.endpoints.filter((ep) => this.endpointReady(ep));
    const imgPrimary = imgReady[0] ?? this.imagePool.endpoints[0] ?? this.defaults.image;
    const vidPrimary = vidReady[0] ?? this.videoPool.endpoints[0] ?? this.defaults.video;
    const audPrimary = audReady[0] ?? this.audioPool.endpoints[0] ?? this.defaults.audio;
    return {
      image: {
        ready: imgReady.length > 0,
        model: imgPrimary.model,
        readyCount: imgReady.length,
        totalCount: this.imagePool.endpoints.length,
        strategy: this.imagePool.strategy
      },
      video: {
        ready: vidReady.length > 0,
        model: vidPrimary.model,
        readyCount: vidReady.length,
        totalCount: this.videoPool.endpoints.length,
        strategy: this.videoPool.strategy
      },
      audio: {
        ready: audReady.length > 0,
        model: audPrimary.model,
        voice: audPrimary.voice,
        readyCount: audReady.length,
        totalCount: this.audioPool.endpoints.length,
        strategy: this.audioPool.strategy
      }
    };
  }
  getConfigDetails() {
    const imageEndpoints = this.imagePool.endpoints.map((ep) => ({
      ...this.toEndpointBaseDetail(ep),
      size: ep.size,
      flavor: ep.flavor
    }));
    const videoEndpoints = this.videoPool.endpoints.map((ep) => ({
      ...this.toEndpointBaseDetail(ep),
      flavor: ep.flavor,
      duration: ep.duration,
      ratio: ep.ratio
    }));
    const audioEndpoints = this.audioPool.endpoints.map((ep) => ({
      ...this.toEndpointBaseDetail(ep),
      voice: ep.voice,
      format: ep.format
    }));
    const imgReadyCount = this.imagePool.endpoints.filter((ep) => this.endpointReady(ep)).length;
    const vidReadyCount = this.videoPool.endpoints.filter((ep) => this.endpointReady(ep)).length;
    const audReadyCount = this.audioPool.endpoints.filter((ep) => this.endpointReady(ep)).length;
    return {
      image: {
        ready: imgReadyCount > 0,
        readyCount: imgReadyCount,
        enabledCount: this.imagePool.endpoints.filter((ep) => ep.enabled).length,
        totalCount: this.imagePool.endpoints.length,
        strategy: this.imagePool.strategy,
        autoFailover: this.imagePool.autoFailover,
        cursor: this.imagePool.cursor,
        endpoints: imageEndpoints
      },
      video: {
        ready: vidReadyCount > 0,
        readyCount: vidReadyCount,
        enabledCount: this.videoPool.endpoints.filter((ep) => ep.enabled).length,
        totalCount: this.videoPool.endpoints.length,
        strategy: this.videoPool.strategy,
        autoFailover: this.videoPool.autoFailover,
        cursor: this.videoPool.cursor,
        endpoints: videoEndpoints
      },
      audio: {
        ready: audReadyCount > 0,
        readyCount: audReadyCount,
        enabledCount: this.audioPool.endpoints.filter((ep) => ep.enabled).length,
        totalCount: this.audioPool.endpoints.length,
        strategy: this.audioPool.strategy,
        autoFailover: this.audioPool.autoFailover,
        cursor: this.audioPool.cursor,
        endpoints: audioEndpoints
      }
    };
  }
  mergeApiKey(patch, prev, byId) {
    if (patch.clearApiKey) return void 0;
    if (typeof patch.apiKey === "string" && patch.apiKey.trim()) return patch.apiKey.trim();
    if (prev?.apiKey) return prev.apiKey;
    if (patch.cloneKeyFromId && byId?.get(patch.cloneKeyFromId)?.apiKey) {
      return byId.get(patch.cloneKeyFromId).apiKey;
    }
    return void 0;
  }
  applyPoolPatch(pool, kind, patch, normalize, makeFallback) {
    const prevById = new Map(pool.endpoints.map((ep) => [ep.id, ep]));
    if (patch.strategy) pool.strategy = normalizeStrategy(patch.strategy, pool.strategy);
    if (typeof patch.autoFailover === "boolean") pool.autoFailover = patch.autoFailover;
    if (Array.isArray(patch.endpoints)) {
      const next = patch.endpoints.map((ep, idx) => {
        if (typeof ep.baseURL === "string") validateEndpointBaseUrl(ep.baseURL);
        const id = typeof ep.id === "string" && ep.id.trim() ? ep.id.trim() : makeEndpointId(kind);
        const prev = prevById.get(id);
        const apiKey = this.mergeApiKey(ep, prev, prevById);
        return normalize({ ...prev, ...ep, id, apiKey }, idx);
      });
      pool.endpoints = next;
      pool.cursor = 0;
    } else {
      if (typeof patch.baseURL === "string") validateEndpointBaseUrl(patch.baseURL);
      const first = pool.endpoints[0] ?? makeFallback();
      const apiKey = this.mergeApiKey(patch, first, prevById);
      pool.endpoints[0] = normalize({ ...first, ...patch, id: first.id, apiKey }, 0);
    }
    for (const ep of pool.endpoints) this.clearCooldown(ep.id);
  }
  async updateConfig(patch) {
    if (patch.image) {
      this.applyPoolPatch(
        this.imagePool,
        "image",
        patch.image,
        (ep, idx) => this.normalizeImageEndpoint(ep, idx),
        () => this.makeDefaultImagePool().endpoints[0]
      );
    }
    if (patch.video) {
      this.applyPoolPatch(
        this.videoPool,
        "video",
        patch.video,
        (ep, idx) => this.normalizeVideoEndpoint(ep, idx),
        () => this.makeDefaultVideoPool().endpoints[0]
      );
    }
    if (patch.audio) {
      this.applyPoolPatch(
        this.audioPool,
        "audio",
        patch.audio,
        (ep, idx) => this.normalizeAudioEndpoint(ep, idx),
        () => this.makeDefaultAudioPool().endpoints[0]
      );
    }
    await this.persistConfig();
    return { status: this.status(), config: this.getConfigDetails() };
  }
  clearCooldown(id) {
    const h = this.health.get(id);
    if (h) {
      delete h.cooldownUntil;
      h.consecutiveFails = 0;
    }
  }
  resetHealth(kind) {
    const clearPool = (eps) => {
      for (const ep of eps) this.health.delete(ep.id);
    };
    if (!kind || kind === "image") {
      clearPool(this.imagePool.endpoints);
      this.imagePool.cursor = 0;
    }
    if (!kind || kind === "video") {
      clearPool(this.videoPool.endpoints);
      this.videoPool.cursor = 0;
    }
    if (!kind || kind === "audio") {
      clearPool(this.audioPool.endpoints);
      this.audioPool.cursor = 0;
    }
    return { status: this.status(), config: this.getConfigDetails() };
  }
  async resetConfig(kind) {
    if (!kind || kind === "image") {
      for (const ep of this.imagePool.endpoints) this.health.delete(ep.id);
      this.imagePool = this.makeDefaultImagePool();
    }
    if (!kind || kind === "video") {
      for (const ep of this.videoPool.endpoints) this.health.delete(ep.id);
      this.videoPool = this.makeDefaultVideoPool();
    }
    if (!kind || kind === "audio") {
      for (const ep of this.audioPool.endpoints) this.health.delete(ep.id);
      this.audioPool = this.makeDefaultAudioPool();
    }
    if (!kind) {
      await rm2(this.configFile, { force: true }).catch(() => {
      });
    } else {
      await this.persistConfig();
    }
    return { status: this.status(), config: this.getConfigDetails() };
  }
  /**
   * 按当前池的调度策略生成本次请求的候选接口队列：
   *  - 仅包含已启用且具备 Base URL + 有效 API Key 的接口；
   *  - 优先调度未处于熔断冷却期（healthy）的接口，冷却中接口按最早解冻时间排在末尾兜底；
   *  - round_robin：支持权重平滑交错轮询，每次调用推进游标；
   *  - failover：严格按列表优先级顺序尝试；
   *  - random：按权重随机选择首选接口，其余按随机顺序作为容错备选。
   */
  selectCandidates(pool, kindLabel) {
    const label = kindLabel === "\u56FE\u7247" ? "\u751F\u56FE" : kindLabel === "\u89C6\u9891" ? "\u89C6\u9891" : "\u914D\u97F3";
    const readyList = pool.endpoints.filter((ep) => this.endpointReady(ep));
    if (readyList.length === 0) {
      throw new MediaConfigError(`${kindLabel}\u751F\u6210\u672A\u914D\u7F6E\uFF1A\u8BF7\u70B9\u51FB\u5DE6\u4E0B\u89D2\u300C${label}\u300D\u72B6\u6001\u56FE\u6807\u81F3\u5C11\u542F\u7528\u5E76\u914D\u7F6E\u4E00\u4E2A\u6709\u6548\u63A5\u53E3\u4E0E API Key`);
    }
    const now = Date.now();
    const healthy = [];
    const cooling = [];
    for (const ep of readyList) {
      const h = this.health.get(ep.id);
      if (h?.cooldownUntil && h.cooldownUntil > now) {
        cooling.push(ep);
      } else {
        healthy.push(ep);
      }
    }
    cooling.sort((a, b) => (this.health.get(a.id)?.cooldownUntil ?? 0) - (this.health.get(b.id)?.cooldownUntil ?? 0));
    let orderedHealthy;
    if (healthy.length <= 1) {
      orderedHealthy = healthy;
    } else if (pool.strategy === "failover") {
      orderedHealthy = healthy;
    } else if (pool.strategy === "random") {
      const remaining = [...healthy];
      orderedHealthy = [];
      while (remaining.length > 0) {
        const totalW = remaining.reduce((acc, it) => acc + clampWeight(it.weight, 1), 0);
        let r = Math.random() * totalW;
        let pickIdx = 0;
        for (let i = 0; i < remaining.length; i++) {
          r -= clampWeight(remaining[i].weight, 1);
          if (r <= 0) {
            pickIdx = i;
            break;
          }
        }
        orderedHealthy.push(remaining.splice(pickIdx, 1)[0]);
      }
    } else {
      const slots = buildInterleavedSlots(healthy);
      const start = pool.cursor % slots.length;
      pool.cursor = (start + 1) % slots.length;
      const seen = /* @__PURE__ */ new Set();
      orderedHealthy = [];
      for (let i = 0; i < slots.length; i++) {
        const cand = slots[(start + i) % slots.length];
        if (!seen.has(cand.id)) {
          seen.add(cand.id);
          orderedHealthy.push(cand);
        }
      }
    }
    const combined = [...orderedHealthy, ...cooling];
    const limited = pool.autoFailover ? combined : combined.slice(0, 1);
    return limited.map((ep) => {
      const { key } = this.resolveKey(ep);
      const base = (ep.baseURL?.trim() ?? "").replace(/\/+$/, "");
      return { ep, base, key };
    });
  }
  async runWithPool(pool, kindLabel, signal, exec) {
    const candidates = this.selectCandidates(pool, kindLabel);
    const errors = [];
    for (const { ep, base, key } of candidates) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("\u5DF2\u53D6\u6D88", "AbortError");
      try {
        const result = await exec(ep, { base, key });
        this.recordSuccess(ep.id);
        return result;
      } catch (error) {
        if (isAbortError(error, signal)) throw error;
        this.recordFailure(ep.id, error);
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`[${ep.name}] ${msg}`);
      }
    }
    if (errors.length === 1) {
      throw new MediaUpstreamError(errors[0]);
    }
    throw new MediaUpstreamError(`${kindLabel}\u751F\u6210\u5931\u8D25\uFF08\u5DF2\u8F6E\u8BE2\u5C1D\u8BD5 ${errors.length} \u4E2A\u63A5\u53E3\uFF09\uFF1A${errors.join("\uFF1B")}`);
  }
  /** 解析本地资产绝对文件路径；外链返回 null。 */
  resolveAssetFile(url) {
    if (!url.startsWith(ASSET_PREFIX)) return null;
    const name3 = decodeURIComponent(url.slice(ASSET_PREFIX.length));
    if (!name3 || name3.includes("/") || name3.includes(String.fromCharCode(92)) || name3.includes("..")) {
      throw new MediaUpstreamError(`\u975E\u6CD5\u8D44\u4EA7\u8DEF\u5F84\uFF1A${url}`);
    }
    return join3(this.assetsDir, name3);
  }
  /** 确保媒体落在本地资产目录（若为外链则下载落盘），返回本地文件路径与资产 URL。 */
  async ensureLocalFile(url, fallbackExt, signal) {
    const local = this.resolveAssetFile(url);
    if (local !== null) return { file: local, url };
    const saved = await this.download(url, fallbackExt, signal);
    const savedFile = this.resolveAssetFile(saved);
    if (savedFile === null) throw new MediaUpstreamError(`\u65E0\u6CD5\u843D\u76D8\u5A92\u4F53\uFF1A${url}`);
    return { file: savedFile, url: saved };
  }
  /** 保存字节为本地资产，返回可访问 URL。 */
  async saveAsset(bytes, ext) {
    await mkdir3(this.assetsDir, { recursive: true });
    const safeExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    const name3 = `${Date.now()}-${randomUUID2().slice(0, 8)}${safeExt}`;
    await writeFile3(join3(this.assetsDir, name3), bytes);
    return ASSET_PREFIX + name3;
  }
  /** 把节点里的媒体地址转换成上游可读的形式：本地资产转 data URL，外链原样。 */
  async toUpstreamRef(url) {
    const file = this.resolveAssetFile(url);
    if (file === null) return url;
    const bytes = await readFile2(file);
    return `data:${mimeOf(file)};base64,${bytes.toString("base64")}`;
  }
  /** 收集当前已配置的媒体端点 origin（用于放行本地 Mock / 自建推理服务，同时继续拦截任意第三方 SSRF）。 */
  getAllowedDownloadOrigins() {
    const origins = /* @__PURE__ */ new Set();
    const all = [
      ...this.imagePool.endpoints,
      ...this.videoPool.endpoints,
      ...this.audioPool.endpoints
    ];
    for (const ep of all) {
      if (!ep.baseURL?.trim()) continue;
      try {
        origins.add(new URL(ep.baseURL.trim()).origin);
      } catch {
      }
    }
    return origins;
  }
  async download(url, fallbackExt, signal, limitBytes = maxDownloadBytes()) {
    if (url.startsWith("data:")) {
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
      if (m === null) throw new MediaUpstreamError("\u4E0A\u6E38\u8FD4\u56DE\u4E86\u65E0\u6CD5\u89E3\u6790\u7684 data URL");
      const bytes2 = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
      if (bytes2.byteLength > limitBytes) {
        throw new MediaUpstreamError(`\u4E0A\u6E38\u8FD4\u56DE\u7684 data URL \u4F53\u79EF\u8D85\u9650\uFF08\u8D85\u8FC7 ${limitBytes} \u5B57\u8282\uFF09`);
      }
      return this.saveAsset(bytes2, extFromMime(m[1] ?? null, fallbackExt));
    }
    await assertSafeRemoteUrl(url, { allowedOrigins: this.getAllowedDownloadOrigins(), label: "\u4E0B\u8F7D\u751F\u6210\u7ED3\u679C" });
    const res = await fetch(url, { signal });
    if (!res.ok) throw new MediaUpstreamError(`\u4E0B\u8F7D\u751F\u6210\u7ED3\u679C\u5931\u8D25\uFF1AHTTP ${res.status}`);
    const bytes = await readResponseBytesWithLimit(res, limitBytes, "\u4E0B\u8F7D\u751F\u6210\u7ED3\u679C");
    return this.saveAsset(bytes, extFromMime(res.headers.get("content-type"), fallbackExt));
  }
  /** 生成一张图片；refs 为参考图 URL（本地资产或外链）。支持多接口动态轮询与失败自动切换。 */
  async generateImage(input, signal) {
    const rawRefs = input.refs ?? [];
    const refs = await Promise.all(rawRefs.map((r) => this.toUpstreamRef(r)));
    return this.runWithPool(this.imagePool, "\u56FE\u7247", signal, async (ep, { base, key }) => {
      const size = input.size ?? ep.size;
      let res;
      if (rawRefs.length > 0 && ep.flavor === "openai") {
        const form = new FormData();
        form.set("model", ep.model);
        form.set("prompt", input.prompt);
        form.set("size", size);
        for (const [i, rawRef] of rawRefs.entries()) {
          const { blob, filename } = await this.loadRefBlob(rawRef, signal);
          const ext = extname(filename) || ".png";
          form.append("image[]", blob, `ref-${i}${ext}`);
        }
        res = await fetch(`${base}/images/edits`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal });
      } else {
        const body = { model: ep.model, prompt: input.prompt, size, n: 1 };
        if (ep.flavor === "ark") {
          body.response_format = "url";
          body.watermark = false;
          if (refs.length > 0) body.image = refs.length === 1 ? refs[0] : refs;
        }
        res = await fetch(`${base}/images/generations`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal
        });
      }
      const json = await readJson(res, "\u56FE\u7247\u751F\u6210");
      const item = json.data?.[0];
      if (item?.b64_json) return { url: await this.saveAsset(Buffer.from(item.b64_json, "base64"), ".png"), model: ep.model };
      if (item?.url) return { url: await this.download(item.url, ".png", signal), model: ep.model };
      throw new MediaUpstreamError(`\u56FE\u7247\u751F\u6210\u8FD4\u56DE\u4E2D\u6CA1\u6709\u56FE\u7247\uFF1A${truncate(JSON.stringify(json))}`);
    });
  }
  /** 把本地资产、data URL 或外链加载为 Blob（供 OpenAI multipart 接口提交首帧/参考图）。 */
  async loadRefBlob(url, signal) {
    const limitBytes = maxDownloadBytes(DEFAULT_MAX_REF_BYTES);
    const file = this.resolveAssetFile(url);
    if (file !== null) {
      const bytes2 = await readFile2(file);
      if (bytes2.byteLength > limitBytes) {
        throw new MediaUpstreamError(`\u672C\u5730\u53C2\u8003\u56FE\u4F53\u79EF\u8D85\u9650\uFF08\u8D85\u8FC7 ${limitBytes} \u5B57\u8282\uFF09`);
      }
      const mime2 = mimeOf(file);
      const ext = extname(file) || extFromMime(mime2, ".png");
      return { blob: new Blob([bytes2], { type: mime2 }), filename: `ref${ext}` };
    }
    if (url.startsWith("data:")) {
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
      if (!m) throw new MediaUpstreamError("\u53C2\u8003\u56FE data URL \u683C\u5F0F\u65E0\u6548");
      const mime2 = m[1] || "image/png";
      const bytes2 = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
      if (bytes2.byteLength > limitBytes) {
        throw new MediaUpstreamError(`\u53C2\u8003\u56FE data URL \u4F53\u79EF\u8D85\u9650\uFF08\u8D85\u8FC7 ${limitBytes} \u5B57\u8282\uFF09`);
      }
      return { blob: new Blob([bytes2], { type: mime2 }), filename: `ref${extFromMime(mime2, ".png")}` };
    }
    await assertSafeRemoteUrl(url, { allowedOrigins: this.getAllowedDownloadOrigins(), label: "\u53C2\u8003\u56FE" });
    const res = await fetch(url, { signal });
    if (!res.ok) throw new MediaUpstreamError(`\u8BFB\u53D6\u53C2\u8003\u56FE\u5931\u8D25\uFF1AHTTP ${res.status}`);
    const mime = res.headers.get("content-type") || "image/png";
    const bytes = await readResponseBytesWithLimit(res, limitBytes, "\u53C2\u8003\u56FE");
    return { blob: new Blob([bytes.buffer], { type: mime }), filename: `ref${extFromMime(mime, ".png")}` };
  }
  /** 生成一段视频（阻塞到完成或超时）；支持多接口动态轮询与失败自动切换。 */
  async generateVideo(input, signal) {
    const firstFrameRef = input.firstFrame ? await this.toUpstreamRef(input.firstFrame) : void 0;
    const extraRefs = await Promise.all((input.extraRefs ?? []).slice(0, 4).map((r) => this.toUpstreamRef(r)));
    const openaiPrimaryRef = input.firstFrame ?? input.extraRefs?.[0];
    return this.runWithPool(this.videoPool, "\u89C6\u9891", signal, async (ep, { base, key }) => {
      const duration = input.duration ?? ep.duration;
      const ratio = input.ratio ?? ep.ratio;
      const auth = { authorization: `Bearer ${key}` };
      const deadline = Date.now() + ep.timeoutMs;
      if (ep.flavor === "ark") {
        const content = [{ type: "text", text: `${input.prompt} --duration ${duration} --ratio ${ratio}` }];
        if (firstFrameRef) {
          content.push({ type: "image_url", image_url: { url: firstFrameRef }, role: "first_frame" });
        }
        for (const ref of extraRefs) {
          content.push({ type: "image_url", image_url: { url: ref }, role: "reference_image" });
        }
        const created2 = await readJson(await fetch(`${base}/contents/generations/tasks`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({ model: ep.model, content }),
          signal
        }), "\u89C6\u9891\u63D0\u4EA4");
        const taskId = String(created2.id ?? "");
        if (!taskId) throw new MediaUpstreamError(`\u89C6\u9891\u63D0\u4EA4\u672A\u8FD4\u56DE\u4EFB\u52A1 id\uFF1A${truncate(JSON.stringify(created2))}`);
        for (; ; ) {
          await sleep(ep.pollIntervalMs, signal);
          const task = await readJson(await fetch(`${base}/contents/generations/tasks/${encodeURIComponent(taskId)}`, { headers: auth, signal }), "\u89C6\u9891\u67E5\u8BE2");
          const status = String(task.status ?? "");
          if (status === "succeeded") {
            const url = task.content?.video_url;
            if (!url) throw new MediaUpstreamError("\u89C6\u9891\u4EFB\u52A1\u6210\u529F\u4F46\u6CA1\u6709 video_url");
            const saved = await this.download(url, ".mp4", signal);
            const probed = await this.probeMedia(saved).catch(() => null);
            return { url: saved, model: ep.model, durationMs: probed?.durationMs ?? duration * 1e3 };
          }
          if (status === "failed" || status === "cancelled" || status === "expired") {
            throw new MediaUpstreamError(`\u89C6\u9891\u4EFB\u52A1${status}\uFF1A${truncate(JSON.stringify(task.error ?? task))}`);
          }
          if (Date.now() > deadline) throw new MediaUpstreamError(`\u89C6\u9891\u4EFB\u52A1\u8D85\u65F6\uFF08${taskId}\uFF09`);
        }
      }
      const size = ratio === "9:16" ? "720x1280" : ratio === "1:1" ? "1024x1024" : "1280x720";
      let submitRes;
      if (openaiPrimaryRef) {
        const { blob, filename } = await this.loadRefBlob(openaiPrimaryRef, signal);
        const form = new FormData();
        form.set("model", ep.model);
        form.set("prompt", input.prompt);
        form.set("seconds", String(duration));
        form.set("size", size);
        form.set("input_reference", blob, filename);
        submitRes = await fetch(`${base}/videos`, {
          method: "POST",
          headers: auth,
          body: form,
          signal
        });
      } else {
        submitRes = await fetch(`${base}/videos`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({ model: ep.model, prompt: input.prompt, seconds: String(duration), size }),
          signal
        });
      }
      const created = await readJson(submitRes, "\u89C6\u9891\u63D0\u4EA4");
      const videoId = String(created.id ?? "");
      if (!videoId) throw new MediaUpstreamError(`\u89C6\u9891\u63D0\u4EA4\u672A\u8FD4\u56DE id\uFF1A${truncate(JSON.stringify(created))}`);
      for (; ; ) {
        await sleep(ep.pollIntervalMs, signal);
        const job = await readJson(await fetch(`${base}/videos/${encodeURIComponent(videoId)}`, { headers: auth, signal }), "\u89C6\u9891\u67E5\u8BE2");
        if (job.status === "completed") {
          const res = await fetch(`${base}/videos/${encodeURIComponent(videoId)}/content`, { headers: auth, signal });
          if (!res.ok) throw new MediaUpstreamError(`\u4E0B\u8F7D\u89C6\u9891\u5931\u8D25\uFF1AHTTP ${res.status}`);
          const bytes = await readResponseBytesWithLimit(res, maxDownloadBytes(), "\u4E0B\u8F7D\u89C6\u9891");
          const saved = await this.saveAsset(bytes, ".mp4");
          const probed = await this.probeMedia(saved).catch(() => null);
          return { url: saved, model: ep.model, durationMs: probed?.durationMs ?? duration * 1e3 };
        }
        if (job.status === "failed") throw new MediaUpstreamError(`\u89C6\u9891\u751F\u6210\u5931\u8D25\uFF1A${truncate(JSON.stringify(job.error ?? job))}`);
        if (Date.now() > deadline) throw new MediaUpstreamError(`\u89C6\u9891\u4EFB\u52A1\u8D85\u65F6\uFF08${videoId}\uFF09`);
      }
    });
  }
  /** 生成一段语音（TTS / 配音）；兼容二进制音频流返回与 JSON URL/b64 返回。支持多接口动态轮询与失败自动切换。 */
  async generateAudio(input, signal) {
    return this.runWithPool(this.audioPool, "\u97F3\u9891", signal, async (ep, { base, key }) => {
      const voice = input.voice?.trim() || ep.voice;
      const format = ep.format;
      const res = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: ep.model,
          input: input.prompt,
          voice,
          response_format: format,
          ...input.speed ? { speed: input.speed } : {}
        }),
        signal
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new MediaUpstreamError(`\u97F3\u9891\u751F\u6210\u5931\u8D25\uFF1AHTTP ${res.status} ${truncate(errText)}`);
      }
      const ct = res.headers.get("content-type") ?? "";
      let saved;
      if (ct.includes("application/json")) {
        const json = await res.json();
        const b64 = json.b64_json ?? json.audio_base64 ?? json.data?.[0]?.b64_json;
        const remoteUrl = json.url ?? json.audio_url ?? json.data?.[0]?.url;
        if (typeof b64 === "string" && b64) {
          saved = await this.saveAsset(Buffer.from(b64, "base64"), `.${format}`);
        } else if (typeof remoteUrl === "string" && remoteUrl) {
          saved = await this.download(remoteUrl, `.${format}`, signal);
        } else {
          throw new MediaUpstreamError(`\u97F3\u9891\u751F\u6210 JSON \u672A\u5305\u542B\u97F3\u9891\u6570\u636E\uFF1A${truncate(JSON.stringify(json))}`);
        }
      } else {
        const bytes = await readResponseBytesWithLimit(res, maxDownloadBytes(DEFAULT_MAX_REF_BYTES), "\u4E0B\u8F7D\u97F3\u9891");
        if (bytes.byteLength === 0) throw new MediaUpstreamError("\u97F3\u9891\u751F\u6210\u8FD4\u56DE\u7A7A\u5185\u5BB9");
        saved = await this.saveAsset(bytes, extFromMime(ct, `.${format}`));
      }
      const probed = await this.probeMedia(saved).catch(() => null);
      return { url: saved, model: ep.model, ...probed?.durationMs ? { durationMs: probed.durationMs } : {} };
    });
  }
  /** 用 ffprobe 探测本地资产目录内的媒体时长、尺寸与是否有音轨（严格限制在 assetsDir 边界内）。 */
  async probeMedia(urlOrFile) {
    let file = null;
    if (urlOrFile.startsWith(ASSET_PREFIX)) {
      file = this.resolveAssetFile(urlOrFile);
    } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(urlOrFile)) {
      const assetsRoot = resolve2(this.assetsDir);
      const resolved = resolve2(urlOrFile);
      if (resolved.startsWith(assetsRoot + sep)) {
        file = resolved;
      }
    }
    if (!file) throw new MediaUpstreamError(`\u65E0\u6CD5\u63A2\u6D4B\u8D44\u4EA7\u76EE\u5F55\u4EE5\u5916\u7684\u8DEF\u5F84\u6216\u5916\u94FE\uFF1A${urlOrFile}`);
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,width,height",
      "-of",
      "json",
      file
    ]);
    const info = JSON.parse(stdout);
    const durSec = Number(info.format?.duration ?? 0);
    const vStream = info.streams?.find((s) => s.codec_type === "video");
    const hasAudio = Boolean(info.streams?.some((s) => s.codec_type === "audio"));
    return {
      durationMs: Number.isFinite(durSec) && durSec > 0 ? Math.round(durSec * 1e3) : 5e3,
      width: vStream?.width ?? 1280,
      height: vStream?.height ?? 720,
      hasAudio
    };
  }
  /** 从视频资产抽取最后一帧 PNG 作为下一段同镜续拍的首帧；若视频并非真实编码（如极简字节 mock），优雅回退返回 null。 */
  async extractLastFrame(videoUrl) {
    const { file } = await this.ensureLocalFile(videoUrl, ".mp4");
    await mkdir3(this.assetsDir, { recursive: true });
    const outName = `${Date.now()}-${randomUUID2().slice(0, 8)}-tail.png`;
    const outPath = join3(this.assetsDir, outName);
    try {
      await execFileAsync(FFMPEG_BIN, [
        "-y",
        "-sseof",
        "-0.15",
        "-i",
        file,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        outPath
      ]);
      const bytes = await readFile2(outPath);
      if (bytes.byteLength > 0) return ASSET_PREFIX + outName;
    } catch {
      await rm2(outPath, { force: true }).catch(() => {
      });
    }
    return null;
  }
  /**
   * 使用 FFmpeg 将多段视频按顺序标准化并拼接为一个完整 MP4 成片。
   * 支持不同分辨率/帧率/有无音轨混拼（统一缩放到首段或指定画幅、30fps、AAC 44.1kHz）、
   * 单段内多条配音按偏移混流，以及可选 SRT 字幕硬烧录。
   */
  async concatVideos(clips, options) {
    if (clips.length === 0) throw new MediaUpstreamError("\u6CA1\u6709\u53EF\u5408\u6210\u7684\u89C6\u9891\u7247\u6BB5");
    await mkdir3(this.assetsDir, { recursive: true });
    const localFiles = [];
    for (const clip of clips) {
      const { file } = await this.ensureLocalFile(clip.url, ".mp4");
      let meta;
      try {
        meta = await this.probeMedia(file);
      } catch {
        throw new MediaUpstreamError(`\u89C6\u9891\u7247\u6BB5\u65E0\u6CD5\u89E3\u7801\uFF08\u8BF7\u786E\u4FDD\u662F\u771F\u5B9E\u6709\u6548\u7684 MP4/\u89C6\u9891\u6587\u4EF6\uFF09\uFF1A${clip.url}`);
      }
      const rawAudios = clip.audioClips && clip.audioClips.length > 0 ? clip.audioClips : clip.audioUrl ? [{ url: clip.audioUrl, startOffsetMs: 0 }] : [];
      const audioFiles = [];
      for (const aud of rawAudios) {
        if (!aud.url) continue;
        const ensured = await this.ensureLocalFile(aud.url, ".mp3");
        audioFiles.push({ file: ensured.file, startOffsetMs: Math.max(0, Math.round(aud.startOffsetMs ?? 0)) });
      }
      localFiles.push({ file, meta, audioFiles });
    }
    const targetW = options?.width ?? (localFiles[0].meta.width || 1280);
    const targetH = options?.height ?? (localFiles[0].meta.height || 720);
    const evenW = targetW % 2 === 0 ? targetW : targetW + 1;
    const evenH = targetH % 2 === 0 ? targetH : targetH + 1;
    const normalizedPaths = [];
    const outName = `${Date.now()}-${randomUUID2().slice(0, 8)}-final.mp4`;
    const outPath = join3(this.assetsDir, outName);
    const mergedPath = join3(this.assetsDir, `${outName}.merged.mp4`);
    const listPath = join3(this.assetsDir, `${outName}.concat.txt`);
    const burnSrtPath = join3(this.assetsDir, `${outName}.burn.srt`);
    try {
      for (const [idx, item] of localFiles.entries()) {
        const segPath = join3(this.assetsDir, `${outName}.seg-${idx}.mp4`);
        normalizedPaths.push(segPath);
        const vf = `scale=${evenW}:${evenH}:force_original_aspect_ratio=decrease,pad=${evenW}:${evenH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30`;
        const durSec = Math.max(0.5, item.meta.durationMs / 1e3);
        if (item.audioFiles.length > 0) {
          const args = ["-y", "-i", item.file];
          const filterParts = [`[0:v]${vf}[v]`];
          const labels = [];
          for (const [aIdx, aud] of item.audioFiles.entries()) {
            args.push("-i", aud.file);
            const delayPart = aud.startOffsetMs > 0 ? `,adelay=${aud.startOffsetMs}|${aud.startOffsetMs}` : "";
            filterParts.push(`[${aIdx + 1}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo${delayPart}[a${aIdx}]`);
            labels.push(`[a${aIdx}]`);
          }
          if (labels.length === 1) {
            filterParts.push(`${labels[0]}apad=whole_dur=${durSec.toFixed(3)},atrim=0:${durSec.toFixed(3)}[a]`);
          } else {
            filterParts.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,apad=whole_dur=${durSec.toFixed(3)},atrim=0:${durSec.toFixed(3)}[a]`);
          }
          args.push(
            "-filter_complex",
            filterParts.join(";"),
            "-map",
            "[v]",
            "-map",
            "[a]",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-t",
            durSec.toFixed(3),
            segPath
          );
          await execFileAsync(FFMPEG_BIN, args);
        } else if (item.meta.hasAudio) {
          await execFileAsync(FFMPEG_BIN, [
            "-y",
            "-i",
            item.file,
            "-vf",
            vf,
            "-af",
            "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            segPath
          ]);
        } else {
          await execFileAsync(FFMPEG_BIN, [
            "-y",
            "-i",
            item.file,
            "-f",
            "lavfi",
            "-t",
            durSec.toFixed(3),
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-vf",
            vf,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-shortest",
            segPath
          ]);
        }
      }
      const nl = String.fromCharCode(10);
      const bs = String.fromCharCode(92);
      const listBody = normalizedPaths.map((p) => `file '${p.replaceAll("'", `'${bs}''`)}'`).join(nl) + nl;
      await writeFile3(listPath, listBody, "utf8");
      const wantBurn = Boolean(options?.burnSubtitles && options.subtitleSrt?.trim());
      const concatTarget = wantBurn ? mergedPath : outPath;
      await execFileAsync(FFMPEG_BIN, ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", concatTarget]);
      let subtitlesBurned = false;
      if (wantBurn && options?.subtitleSrt) {
        await writeFile3(burnSrtPath, options.subtitleSrt, "utf8");
        const escapedSrt = burnSrtPath.replaceAll(bs, `${bs}${bs}`).replaceAll(":", `${bs}:`).replaceAll("'", `${bs}'`);
        try {
          await execFileAsync(FFMPEG_BIN, [
            "-y",
            "-i",
            mergedPath,
            "-vf",
            `subtitles='${escapedSrt}':force_style='FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=1.5'`,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
            outPath
          ]);
          subtitlesBurned = true;
        } catch {
          await execFileAsync(FFMPEG_BIN, ["-y", "-i", mergedPath, "-c", "copy", "-movflags", "+faststart", outPath]);
        }
      }
      const finalMeta = await this.probeMedia(outPath);
      return { url: ASSET_PREFIX + outName, durationMs: finalMeta.durationMs, width: evenW, height: evenH, subtitlesBurned };
    } finally {
      await rm2(listPath, { force: true }).catch(() => {
      });
      await rm2(mergedPath, { force: true }).catch(() => {
      });
      await rm2(burnSrtPath, { force: true }).catch(() => {
      });
      for (const p of normalizedPaths) await rm2(p, { force: true }).catch(() => {
      });
    }
  }
};
async function readJson(res, what) {
  const text = await res.text();
  if (!res.ok) throw new MediaUpstreamError(`${what}\u5931\u8D25\uFF1AHTTP ${res.status} ${truncate(text)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new MediaUpstreamError(`${what}\u8FD4\u56DE\u975E JSON\uFF1A${truncate(text)}`);
  }
}
function truncate(s, n = 400) {
  return s.length > n ? `${s.slice(0, n)}\u2026` : s;
}
function sleep(ms, signal) {
  return new Promise((resolve3, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve3();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// mujing/canvas/src/host/service.ts
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const poolSize = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: poolSize }, async () => {
      while (nextIndex < items.length) {
        const cur = nextIndex++;
        results[cur] = await worker(items[cur], cur);
      }
    })
  );
  return results;
}
var Config = z.object({
  dataDir: z.string().description("\u753B\u5E03\u4E0E\u8D44\u4EA7\u6570\u636E\u76EE\u5F55\uFF0C\u9ED8\u8BA4 $DSH_HOME/mujing"),
  image: z.object({
    baseURL: z.string().description("OpenAI \u517C\u5BB9\u56FE\u7247\u670D\u52A1\u5730\u5740\uFF08\u542B /v1\uFF09"),
    apiKeyEnv: z.string().default("MUJING_IMAGE_API_KEY").description("\u4FDD\u5B58\u56FE\u7247\u670D\u52A1\u5BC6\u94A5\u7684\u73AF\u5883\u53D8\u91CF\u540D"),
    model: z.string().default("gpt-image-1"),
    size: z.string().default("1024x1024"),
    flavor: z.union(["openai", "ark"]).default("openai")
  }).default({}),
  video: z.object({
    baseURL: z.string().description("\u89C6\u9891\u670D\u52A1\u5730\u5740\uFF1AOpenAI \u517C\u5BB9\uFF08/v1\uFF09\u6216\u706B\u5C71\u65B9\u821F\uFF08https://ark.cn-beijing.volces.com/api/v3\uFF09"),
    apiKeyEnv: z.string().default("MUJING_VIDEO_API_KEY"),
    model: z.string().default("doubao-seedance-1-0-pro-250528"),
    flavor: z.union(["openai", "ark"]).default("ark"),
    duration: z.number().default(5),
    ratio: z.string().default("16:9"),
    pollIntervalMs: z.number().default(5e3),
    timeoutMs: z.number().default(15 * 6e4)
  }).default({}),
  audio: z.object({
    baseURL: z.string().description("OpenAI \u517C\u5BB9\u8BED\u97F3\u5408\u6210\u670D\u52A1\u5730\u5740\uFF08\u542B /v1\uFF09"),
    apiKeyEnv: z.string().default("MUJING_AUDIO_API_KEY").description("\u4FDD\u5B58\u8BED\u97F3\u670D\u52A1\u5BC6\u94A5\u7684\u73AF\u5883\u53D8\u91CF\u540D"),
    model: z.string().default("gpt-4o-mini-tts"),
    voice: z.string().default("alloy"),
    format: z.union(["mp3", "wav"]).default("mp3")
  }).default({})
});
var MujingService = class extends Service {
  store;
  media;
  dataDir;
  /** UI 当前打开的画布；Agent 工具缺省 project_id 时使用。 */
  activeProjectId;
  /** 进行中的生成任务，key 为节点 id 或任务键。 */
  running = /* @__PURE__ */ new Map();
  constructor(ctx, config) {
    super(ctx, "mujing");
    this.dataDir = config.dataDir ?? join4(process.env.DSH_HOME ?? join4(homedir2(), ".dsh"), "mujing");
    this.store = new ProjectStore(this.dataDir);
    this.media = new MediaService(this.dataDir, config.image, config.video, config.audio);
    ctx.effect(() => () => {
      for (const c of this.running.values()) c.abort(new Error("mujing \u63D2\u4EF6\u5DF2\u5378\u8F7D"));
      this.running.clear();
    });
  }
  /** 解析 Agent 传入的项目 id：缺省取当前画布，再缺省取最近更新的画布。 */
  async resolveProjectId(id) {
    if (id) return id;
    if (this.activeProjectId) return this.activeProjectId;
    const [latest] = await this.store.list();
    if (latest === void 0) throw new CanvasOpError("\u8FD8\u6CA1\u6709\u4EFB\u4F55\u753B\u5E03\uFF1A\u5148\u8C03\u7528 canvas_create_project \u521B\u5EFA\u4E00\u4E2A");
    return latest.id;
  }
  isRunning(nodeId) {
    return this.running.has(nodeId);
  }
  /**
   * 在节点上发起生成（image / video / audio）：立即把节点置为 loading 并返回 `{ nodeId, done }`。
   */
  async startGeneration(req, signal) {
    const project = await this.store.get(req.projectId);
    const refs = (req.referenceNodeIds ?? []).map((id2) => {
      const node = project.nodes.find((n) => n.id === id2);
      if (node === void 0) throw new CanvasOpError(`\u53C2\u8003\u8282\u70B9\u4E0D\u5B58\u5728\uFF1A${id2}`);
      if (!node.url) throw new CanvasOpError(`\u53C2\u8003\u8282\u70B9 ${id2} \u8FD8\u6CA1\u6709\u5A92\u4F53\u5185\u5BB9`);
      return node.url;
    });
    let nodeId = req.nodeId;
    if (nodeId === void 0) {
      const { created } = await this.store.apply(req.projectId, [{
        op: "add_node",
        type: req.kind,
        title: req.title,
        prompt: req.prompt,
        voice: req.voice,
        x: req.x,
        y: req.y
      }]);
      nodeId = created[0];
      for (const ref of req.referenceNodeIds ?? []) {
        await this.store.apply(req.projectId, [{ op: "connect", source: ref, target: nodeId }]);
      }
    } else {
      const node = project.nodes.find((n) => n.id === nodeId);
      if (node === void 0) throw new CanvasOpError(`\u8282\u70B9\u4E0D\u5B58\u5728\uFF1A${nodeId}`);
      if (node.type !== req.kind) throw new CanvasOpError(`\u8282\u70B9 ${nodeId} \u662F ${node.type} \u8282\u70B9\uFF0C\u4E0D\u80FD\u751F\u6210 ${req.kind}`);
      if (this.running.has(nodeId)) throw new CanvasOpError(`\u8282\u70B9 ${nodeId} \u6B63\u5728\u751F\u6210\u4E2D`);
    }
    const id = nodeId;
    await this.store.apply(req.projectId, [{
      op: "update_node",
      id,
      prompt: req.prompt,
      ...req.voice !== void 0 ? { voice: req.voice } : {},
      status: "loading",
      error: ""
    }], false);
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    this.running.set(id, controller);
    const done = (async () => {
      let patch;
      try {
        if (req.kind === "image") {
          const allRefs = [...refs, ...req.extraRefUrls ?? []];
          const out = await this.media.generateImage({ prompt: req.prompt, size: req.size, refs: allRefs }, controller.signal);
          patch = { url: out.url, model: out.model, status: "success", error: "" };
        } else if (req.kind === "video") {
          const firstFrame = req.firstFrameUrl ?? refs[0];
          const extraRefs = [...req.firstFrameUrl ? refs : refs.slice(1), ...req.extraRefUrls ?? []];
          const out = await this.media.generateVideo({
            prompt: req.prompt,
            duration: req.duration,
            ratio: req.ratio,
            firstFrame,
            extraRefs
          }, controller.signal);
          patch = { url: out.url, model: out.model, durationMs: out.durationMs, status: "success", error: "" };
        } else {
          const out = await this.media.generateAudio({ prompt: req.prompt, voice: req.voice }, controller.signal);
          patch = { url: out.url, model: out.model, durationMs: out.durationMs, status: "success", error: "" };
        }
      } catch (error) {
        patch = { status: "error", error: error instanceof Error ? error.message : String(error) };
      } finally {
        signal?.removeEventListener("abort", onAbort);
        this.running.delete(id);
      }
      try {
        const { project: next } = await this.store.apply(req.projectId, [{ op: "update_node", id, ...patch }], false);
        return next.nodes.find((n) => n.id === id) ?? { id, type: req.kind, x: 0, y: 0, width: 0, height: 0, ...patch };
      } catch {
        return { id, type: req.kind, x: 0, y: 0, width: 0, height: 0, ...patch };
      }
    })();
    return { nodeId: id, done };
  }
  cancelGeneration(nodeId) {
    const c = this.running.get(nodeId);
    if (c === void 0) return false;
    c.abort(new Error("\u7528\u6237\u53D6\u6D88"));
    return true;
  }
  /* ───────────────────────── 短剧制作流水线编排 ───────────────────────── */
  /** 保存/增量更新短剧世界观、小说原文、角色设定与分集分镜；自动重算各集视频段提示词。 */
  async saveDrama(projectId, patch) {
    let updated = await this.store.updateDomain(projectId, (p) => {
      const d = ensureDrama(p);
      if (patch.genre !== void 0) d.genre = patch.genre.trim() || void 0;
      if (patch.logline !== void 0) d.logline = patch.logline.trim() || void 0;
      if (patch.style !== void 0) d.style = patch.style.trim() || d.style;
      if (patch.aspectRatio !== void 0) d.aspectRatio = patch.aspectRatio;
      if (patch.language !== void 0) d.language = patch.language.trim() || d.language;
      if (patch.segmentTargetSec !== void 0 && patch.segmentTargetSec >= 3 && patch.segmentTargetSec <= 15) {
        d.segmentTargetSec = patch.segmentTargetSec;
      }
      if (patch.novelText !== void 0) d.novelText = patch.novelText;
      if (patch.casts !== void 0) {
        const prevByName = new Map(d.casts.map((c) => [c.name, c]));
        const prevById = new Map(d.casts.map((c) => [c.id, c]));
        d.casts = patch.casts.map((c) => {
          const prev = (c.id ? prevById.get(c.id) : void 0) ?? prevByName.get(c.name);
          const kind = c.kind ?? prev?.kind ?? "character";
          const appearance = c.appearance?.trim() || prev?.appearance || "";
          const defaultImgPrompt = kind === "character" ? `${c.name}\uFF0C\u89D2\u8272\u8BBE\u5B9A\u4E09\u89C6\u56FE\uFF08\u6B63\u9762\u3001\u4FA7\u9762\u3001\u80CC\u9762\u5168\u8EAB\u4E0E\u9762\u90E8\u7279\u5199\uFF09\uFF0C\u767D\u5E95\u8BBE\u5B9A\u5361\uFF0C${appearance}\uFF0C${d.style}` : `${c.name}\uFF0C${appearance}\uFF0C${d.style}`;
          return {
            id: c.id ?? prev?.id ?? shortId("cast"),
            kind,
            name: c.name.trim(),
            ...c.role ?? prev?.role ? { role: c.role ?? prev?.role } : {},
            appearance,
            imagePrompt: c.imagePrompt?.trim() || prev?.imagePrompt || defaultImgPrompt,
            ...c.voice ?? prev?.voice ? { voice: c.voice ?? prev?.voice } : {},
            ...c.imageNodeId ?? prev?.imageNodeId ? { imageNodeId: c.imageNodeId ?? prev?.imageNodeId } : {},
            ...c.imageUrl ?? prev?.imageUrl ? { imageUrl: c.imageUrl ?? prev?.imageUrl } : {},
            locked: c.locked ?? prev?.locked ?? false
          };
        });
      }
      if (patch.episodes !== void 0) {
        const prevByNum = new Map(d.episodes.map((e) => [e.number, e]));
        const prevById = new Map(d.episodes.map((e) => [e.id, e]));
        d.episodes = patch.episodes.map((ep) => {
          const prev = (ep.id ? prevById.get(ep.id) : void 0) ?? prevByNum.get(ep.number);
          const prevShotsById = new Map((prev?.shots ?? []).map((s) => [s.id, s]));
          const shots = ep.shots !== void 0 ? ep.shots.map((s, idx) => {
            const prevShot = (s.id ? prevShotsById.get(s.id) : void 0) ?? prev?.shots[idx];
            return {
              id: s.id ?? prevShot?.id ?? shortId("shot"),
              segmentIndex: typeof s.segmentIndex === "number" ? s.segmentIndex : prevShot?.segmentIndex ?? 0,
              scene: s.scene?.trim() || prevShot?.scene || "\u4E3B\u573A\u666F",
              shotSize: s.shotSize?.trim() || prevShot?.shotSize || "\u4E2D\u666F",
              camera: s.camera?.trim() || prevShot?.camera || "\u56FA\u5B9A",
              action: s.action.trim(),
              ...s.imagePrompt ?? prevShot?.imagePrompt ? { imagePrompt: s.imagePrompt ?? prevShot?.imagePrompt } : {},
              ...s.videoPrompt ?? prevShot?.videoPrompt ? { videoPrompt: s.videoPrompt ?? prevShot?.videoPrompt } : {},
              ...s.speaker !== void 0 ? s.speaker ? { speaker: s.speaker } : {} : prevShot?.speaker ? { speaker: prevShot.speaker } : {},
              ...s.dialogue !== void 0 ? s.dialogue ? { dialogue: s.dialogue } : {} : prevShot?.dialogue ? { dialogue: prevShot.dialogue } : {},
              durationMs: typeof s.durationMs === "number" && s.durationMs >= 1500 ? Math.round(s.durationMs) : prevShot?.durationMs ?? 3500,
              ...s.castIds ?? prevShot?.castIds ? { castIds: s.castIds ?? prevShot?.castIds } : {},
              ...s.transition ?? prevShot?.transition ? { transition: s.transition ?? prevShot?.transition } : {},
              ...s.keyframeNodeId ?? prevShot?.keyframeNodeId ? { keyframeNodeId: s.keyframeNodeId ?? prevShot?.keyframeNodeId } : {},
              ...s.keyframeUrl ?? prevShot?.keyframeUrl ? { keyframeUrl: s.keyframeUrl ?? prevShot?.keyframeUrl } : {},
              ...s.audioNodeId ?? prevShot?.audioNodeId ? { audioNodeId: s.audioNodeId ?? prevShot?.audioNodeId } : {},
              ...s.audioUrl ?? prevShot?.audioUrl ? { audioUrl: s.audioUrl ?? prevShot?.audioUrl } : {}
            };
          }) : prev?.shots ?? [];
          const nextEp = {
            id: ep.id ?? prev?.id ?? shortId("ep"),
            number: ep.number,
            title: ep.title.trim() || `\u7B2C${ep.number}\u96C6`,
            synopsis: ep.synopsis ?? prev?.synopsis ?? "",
            ...ep.hook ?? prev?.hook ? { hook: ep.hook ?? prev?.hook } : {},
            ...ep.cliffhanger ?? prev?.cliffhanger ? { cliffhanger: ep.cliffhanger ?? prev?.cliffhanger } : {},
            ...ep.sourceText ?? prev?.sourceText ? { sourceText: ep.sourceText ?? prev?.sourceText } : {},
            shots,
            segments: [],
            ...prev?.finalVideoUrl ? { finalVideoUrl: prev.finalVideoUrl } : {},
            ...prev?.subtitleSrt ? { subtitleSrt: prev.subtitleSrt } : {}
          };
          nextEp.segments = buildEpisodeSegments(d, nextEp, prev?.segments);
          nextEp.subtitleSrt = buildEpisodeCaptions(nextEp).srt;
          return nextEp;
        }).sort((a, b) => a.number - b.number);
      } else {
        for (const ep of d.episodes) {
          ep.segments = buildEpisodeSegments(d, ep, ep.segments);
        }
      }
    });
    if (patch.syncCanvasNodes !== false) {
      updated = await this.syncDramaToCanvas(projectId);
    }
    return updated;
  }
  /** 修改、新增或删除单集中的分镜条目，并自动重算该集剧情分段提示词与字幕（默认保留既有分段归属）。 */
  async updateDramaShot(projectId, episodeIdOrNum, input) {
    const updated = await this.store.updateDomain(projectId, (p) => {
      const d = ensureDrama(p);
      const ep = d.episodes.find((e) => e.id === episodeIdOrNum || e.number === Number(episodeIdOrNum));
      if (!ep) throw new CanvasOpError(`\u627E\u4E0D\u5230\u5267\u96C6\uFF1A${String(episodeIdOrNum)}`);
      const idx = input.shotId ? ep.shots.findIndex((s) => s.id === input.shotId) : typeof input.shotIndex === "number" ? input.shotIndex : -1;
      if (input.delete) {
        if (idx < 0 || idx >= ep.shots.length) throw new CanvasOpError("\u627E\u4E0D\u5230\u8981\u5220\u9664\u7684\u5206\u955C");
        ep.shots.splice(idx, 1);
      } else if (idx >= 0 && idx < ep.shots.length) {
        const cur = ep.shots[idx];
        const sp = input.patch ?? {};
        if (sp.scene !== void 0) cur.scene = sp.scene.trim() || cur.scene;
        if (sp.shotSize !== void 0) cur.shotSize = sp.shotSize.trim() || cur.shotSize;
        if (sp.camera !== void 0) cur.camera = sp.camera.trim() || cur.camera;
        if (sp.action !== void 0) cur.action = sp.action.trim() || cur.action;
        if (sp.imagePrompt !== void 0) cur.imagePrompt = sp.imagePrompt.trim() || void 0;
        if (sp.videoPrompt !== void 0) cur.videoPrompt = sp.videoPrompt.trim() || void 0;
        if (sp.speaker !== void 0) cur.speaker = sp.speaker.trim() || void 0;
        if (sp.dialogue !== void 0) cur.dialogue = sp.dialogue.trim() || void 0;
        if (typeof sp.durationMs === "number" && sp.durationMs >= 1500) cur.durationMs = Math.round(sp.durationMs);
        if (sp.transition !== void 0) cur.transition = sp.transition;
        if (typeof sp.segmentIndex === "number" && Number.isInteger(sp.segmentIndex) && sp.segmentIndex >= 0) {
          cur.segmentIndex = sp.segmentIndex;
        }
      } else {
        const sp = input.patch ?? {};
        if (!sp.action?.trim()) throw new CanvasOpError("\u65B0\u589E\u5206\u955C\u5FC5\u987B\u586B\u5199\u753B\u9762\u52A8\u4F5C\u63CF\u8FF0");
        const lastShot = ep.shots.at(-1);
        const scene = sp.scene?.trim() || lastShot?.scene || "\u4E3B\u573A\u666F";
        const durMs = typeof sp.durationMs === "number" && sp.durationMs >= 1500 ? Math.round(sp.durationMs) : 3500;
        let defaultSegIndex = 0;
        if (typeof sp.segmentIndex === "number" && Number.isInteger(sp.segmentIndex) && sp.segmentIndex >= 0) {
          defaultSegIndex = sp.segmentIndex;
        } else if (ep.segments.length > 0 && lastShot) {
          const lastSegIdx = Math.max(0, lastShot.segmentIndex);
          const lastSegShots = ep.shots.filter((s) => s.segmentIndex === lastSegIdx);
          const lastSegMs = lastSegShots.reduce((acc, s) => acc + Math.max(1500, s.durationMs || 3e3), 0);
          const maxMs = Math.max(3e3, Math.min(15e3, Math.round((d.segmentTargetSec || 8) * 1e3)));
          const sameScene = !lastShot.scene || scene === lastShot.scene;
          defaultSegIndex = sameScene && lastSegMs + durMs <= maxMs && lastSegShots.length < 4 ? lastSegIdx : lastSegIdx + 1;
        }
        ep.shots.push({
          id: shortId("shot"),
          segmentIndex: defaultSegIndex,
          scene,
          shotSize: sp.shotSize?.trim() || "\u4E2D\u666F",
          camera: sp.camera?.trim() || "\u56FA\u5B9A",
          action: sp.action.trim(),
          ...sp.imagePrompt?.trim() ? { imagePrompt: sp.imagePrompt.trim() } : {},
          ...sp.speaker?.trim() ? { speaker: sp.speaker.trim() } : {},
          ...sp.dialogue?.trim() ? { dialogue: sp.dialogue.trim() } : {},
          durationMs: durMs,
          ...sp.transition ? { transition: sp.transition } : {}
        });
      }
      if (input.resegment) {
        for (const s of ep.shots) s.segmentIndex = 0;
      }
      ep.segments = buildEpisodeSegments(d, ep, ep.segments);
      ep.subtitleSrt = buildEpisodeCaptions(ep).srt;
    });
    return this.syncDramaToCanvas(projectId).catch(() => updated);
  }
  /** 为单镜或整集生成故事板关键帧图片（keyframe）或角色台词配音（audio）。 */
  async generateDramaShotMedia(projectId, episodeIdOrNum, options, signal) {
    await this.syncDramaToCanvas(projectId);
    const project = await this.store.get(projectId);
    const drama = project.drama;
    if (!drama) throw new CanvasOpError("\u5F53\u524D\u9879\u76EE\u5C1A\u672A\u914D\u7F6E\u77ED\u5267\u6D41\u6C34\u7EBF");
    const ep = drama.episodes.find((e) => e.id === episodeIdOrNum || e.number === Number(episodeIdOrNum));
    if (!ep) throw new CanvasOpError(`\u627E\u4E0D\u5230\u5267\u96C6\uFF1A${String(episodeIdOrNum)}`);
    const targets = ep.shots.map((shot, idx) => ({ shot, shotNumber: idx + 1 })).filter(({ shot, shotNumber }) => {
      if (options.shotId) return shot.id === options.shotId;
      if (typeof options.shotIndex === "number") return shotNumber - 1 === options.shotIndex;
      return options.kind === "audio" ? Boolean(shot.dialogue?.trim()) : true;
    });
    if (targets.length === 0) {
      throw new CanvasOpError(options.kind === "audio" ? "\u76EE\u6807\u955C\u5934\u6CA1\u6709\u53EF\u6717\u8BFB\u7684\u53F0\u8BCD" : "\u627E\u4E0D\u5230\u76EE\u6807\u5206\u955C");
    }
    const size = drama.aspectRatio === "9:16" ? "1024x1536" : drama.aspectRatio === "16:9" ? "1536x1024" : "1024x1024";
    const linkShotMedia = async (shotId, nodeId, url) => {
      if (!nodeId && !url) return;
      await this.store.updateDomain(projectId, (p) => {
        const targetEp = p.drama?.episodes.find((e) => e.id === ep.id);
        const s = targetEp?.shots.find((item) => item.id === shotId);
        if (!s) return;
        if (options.kind === "keyframe") {
          if (nodeId) s.keyframeNodeId = nodeId;
          if (url) s.keyframeUrl = url;
        } else {
          if (nodeId) s.audioNodeId = nodeId;
          if (url) s.audioUrl = url;
        }
      }, false);
    };
    const rawResults = await mapWithConcurrency(targets, 3, async ({ shot, shotNumber }) => {
      if (signal?.aborted) {
        return { shotId: shot.id, shotNumber, error: "\u5DF2\u53D6\u6D88" };
      }
      if (options.kind === "keyframe") {
        const prompt = compileShotKeyframePrompt(drama, shot);
        const refs = collectShotCastRefs(project, [shot]);
        const { nodeId: nodeId2, done: done2 } = await this.startGeneration({
          projectId,
          kind: "image",
          nodeId: shot.keyframeNodeId,
          title: `\u7B2C${ep.number}\u96C6\xB7\u955C${shotNumber}\u5173\u952E\u5E27`,
          prompt,
          size,
          extraRefUrls: refs,
          x: 80 + (shotNumber - 1) * 340,
          y: 780 + (ep.number - 1) * 360
        }, signal);
        const finalNode2 = await done2;
        await linkShotMedia(shot.id, nodeId2, finalNode2.url);
        return { shotId: shot.id, shotNumber, nodeId: nodeId2, url: finalNode2.url, error: finalNode2.error };
      }
      const dlg = shot.dialogue?.trim();
      if (!dlg) return null;
      const speakerCast = shot.speaker ? drama.casts.find((c) => c.name === shot.speaker) : void 0;
      const voice = speakerCast?.voice || void 0;
      const { nodeId, done } = await this.startGeneration({
        projectId,
        kind: "audio",
        nodeId: shot.audioNodeId,
        title: `\u7B2C${ep.number}\u96C6\xB7\u955C${shotNumber}\u914D\u97F3${shot.speaker ? `\xB7${shot.speaker}` : ""}`,
        prompt: dlg,
        voice,
        x: 80 + (shotNumber - 1) * 340,
        y: 1120 + (ep.number - 1) * 200
      }, signal);
      const finalNode = await done;
      await linkShotMedia(shot.id, nodeId, finalNode.url);
      return { shotId: shot.id, shotNumber, nodeId, url: finalNode.url, error: finalNode.error };
    });
    const results = rawResults.filter((r) => r !== null);
    return {
      episodeId: ep.id,
      kind: options.kind,
      generated: results.map(({ shotId, shotNumber, url, error }) => ({ shotId, shotNumber, ...url ? { url } : {}, ...error ? { error } : {} }))
    };
  }
  /** 修改某一段的接续模式（handoff）或自定义提示词。 */
  async updateDramaSegment(projectId, episodeId, segmentIndex, patch) {
    return this.store.updateDomain(projectId, (p) => {
      const d = ensureDrama(p);
      const ep = d.episodes.find((e) => e.id === episodeId || String(e.number) === episodeId);
      if (!ep) throw new CanvasOpError(`\u5267\u96C6\u4E0D\u5B58\u5728\uFF1A${episodeId}`);
      const seg = ep.segments.find((s) => s.index === segmentIndex);
      if (!seg) throw new CanvasOpError(`\u5206\u6BB5\u4E0D\u5B58\u5728\uFF1A${segmentIndex}`);
      if (patch.handoff !== void 0) {
        seg.handoff = patch.handoff;
        if (patch.prompt === void 0) {
          const rebuilt = buildEpisodeSegments(d, ep, ep.segments);
          const target = rebuilt.find((s) => s.index === segmentIndex);
          if (target) seg.prompt = target.prompt;
        }
      }
      if (patch.prompt !== void 0) seg.prompt = patch.prompt;
    });
  }
  /** 将短剧的角色设定卡与分集剧本映射/更新到画布节点上，实现「流水线 ↔ 无限画布」双向贯通。 */
  async syncDramaToCanvas(projectId) {
    return this.store.updateDomain(projectId, (p) => {
      const d = p.drama;
      if (!d) return;
      d.casts.forEach((cast, idx) => {
        const nodeId = cast.imageNodeId ?? `cast_${cast.id}`;
        cast.imageNodeId = nodeId;
        const existing = p.nodes.find((n) => n.id === nodeId);
        const title = `${cast.kind === "character" ? "\u89D2\u8272" : cast.kind === "scene" ? "\u573A\u666F" : "\u9053\u5177"} \xB7 ${cast.name}`;
        if (existing) {
          existing.title = title;
          existing.prompt = cast.imagePrompt;
          if (existing.url) cast.imageUrl = existing.url;
        } else {
          p.nodes.push({
            id: nodeId,
            type: "image",
            x: 80 + idx * 380,
            y: 60,
            width: 320,
            height: 320,
            title,
            prompt: cast.imagePrompt,
            ...cast.imageUrl ? { url: cast.imageUrl, status: "success" } : { status: "idle" }
          });
        }
      });
      d.episodes.forEach((ep, epIdx) => {
        const rowY = 440 + epIdx * 320;
        const scriptNodeId = `ep_script_${ep.number}`;
        const md = formatEpisodeMarkdown(ep);
        const existingScript = p.nodes.find((n) => n.id === scriptNodeId);
        if (existingScript) {
          existingScript.title = `\u7B2C${ep.number}\u96C6\u5267\u672C \xB7 ${ep.title}`;
          existingScript.content = md;
        } else {
          p.nodes.push({
            id: scriptNodeId,
            type: "text",
            x: 80,
            y: rowY,
            width: 360,
            height: 240,
            title: `\u7B2C${ep.number}\u96C6\u5267\u672C \xB7 ${ep.title}`,
            content: md,
            status: "idle"
          });
        }
        ep.segments.forEach((seg, segIdx) => {
          const vNodeId = seg.videoNodeId ?? `ep${ep.number}_seg${segIdx + 1}`;
          seg.videoNodeId = vNodeId;
          const existingV = p.nodes.find((n) => n.id === vNodeId);
          const [vw, vh] = d.aspectRatio === "9:16" ? [216, 384] : [384, 216];
          if (existingV) {
            existingV.title = seg.title;
            existingV.prompt = seg.prompt;
          } else {
            p.nodes.push({
              id: vNodeId,
              type: "video",
              x: 500 + segIdx * (vw + 80),
              y: rowY,
              width: vw,
              height: vh,
              title: seg.title,
              prompt: seg.prompt,
              status: "idle"
            });
          }
          const prevSeg = segIdx > 0 ? ep.segments[segIdx - 1] : void 0;
          const upSource = segIdx === 0 ? scriptNodeId : prevSeg?.videoNodeId ?? `ep${ep.number}_seg${segIdx}`;
          if (!p.edges.some((e) => e.source === upSource && e.target === vNodeId)) {
            p.edges.push({ id: shortId("e"), source: upSource, target: vNodeId });
          }
        });
      });
    }, false);
  }
  /** 为单个或全部未锁定的角色/场景生成设定图（三视图卡），完成后自动锁定（限流并发上限 3）。 */
  async generateDramaCastImage(projectId, castId, signal) {
    await this.syncDramaToCanvas(projectId);
    const project = await this.store.get(projectId);
    const d = project.drama;
    if (!d || d.casts.length === 0) throw new CanvasOpError("\u5F53\u524D\u9879\u76EE\u8FD8\u6CA1\u6709\u89D2\u8272/\u573A\u666F\u8BBE\u5B9A");
    const targets = castId ? d.casts.filter((c) => c.id === castId || c.name === castId) : d.casts.filter((c) => !c.locked || !c.imageUrl);
    if (targets.length === 0) return { generated: [] };
    const size = d.aspectRatio === "9:16" ? "1024x1536" : d.aspectRatio === "16:9" ? "1536x1024" : "1024x1024";
    const jobs = await mapWithConcurrency(targets, 3, async (cast) => {
      const { done } = await this.startGeneration({
        projectId,
        kind: "image",
        nodeId: cast.imageNodeId,
        title: `\u89D2\u8272 \xB7 ${cast.name}`,
        prompt: cast.imagePrompt,
        size
      }, signal);
      const finalNode = await done;
      return { castId: cast.id, name: cast.name, url: finalNode.url, error: finalNode.error };
    });
    await this.store.updateDomain(projectId, (p) => {
      const drama = p.drama;
      if (!drama) return;
      for (const res of jobs) {
        const c = drama.casts.find((item) => item.id === res.castId);
        if (c && res.url) {
          c.imageUrl = res.url;
          c.locked = true;
        }
      }
      for (const ep of drama.episodes) {
        ep.segments = buildEpisodeSegments(drama, ep, ep.segments);
      }
    }, false);
    return { generated: jobs };
  }
  /**
   * 按段顺序推进单集视频生成（核心连续性保障）：
   *  - 若某段 handoff === 'continue' 且上一段已有成片，则用 FFmpeg 抽取上一段真实尾帧作为本段首帧（first_frame）；
   *  - 自动附带本段出场角色已锁定的三视图设定图（extraRefUrls）；
   *  - 可指定只跑单段（segmentIndex），或跑整集（缺省）。
   */
  async runDramaEpisode(projectId, episodeIdOrNum, options, signal) {
    await this.syncDramaToCanvas(projectId);
    const initial = await this.store.get(projectId);
    const drama = initial.drama;
    if (!drama) throw new CanvasOpError("\u5F53\u524D\u9879\u76EE\u5C1A\u672A\u914D\u7F6E\u77ED\u5267\u6D41\u6C34\u7EBF");
    const ep = drama.episodes.find((e) => e.id === episodeIdOrNum || e.number === Number(episodeIdOrNum));
    if (!ep) throw new CanvasOpError(`\u627E\u4E0D\u5230\u5267\u96C6\uFF1A${String(episodeIdOrNum)}`);
    if (ep.segments.length === 0) throw new CanvasOpError(`\u7B2C${ep.number}\u96C6\u8FD8\u6CA1\u6709\u5206\u955C\u6BB5`);
    const indices = options?.segmentIndex !== void 0 ? [options.segmentIndex] : ep.segments.map((s) => s.index);
    const results = [];
    for (const idx of indices) {
      const curProj = await this.store.get(projectId);
      const curDrama = curProj.drama;
      const curEp = curDrama.episodes.find((e) => e.id === ep.id);
      const seg = curEp.segments.find((s) => s.index === idx);
      if (!seg) throw new CanvasOpError(`\u627E\u4E0D\u5230\u5206\u6BB5\uFF1A${idx}`);
      const curNode = seg.videoNodeId ? curProj.nodes.find((n) => n.id === seg.videoNodeId) : void 0;
      if (!options?.forceRegenerate && options?.segmentIndex === void 0 && curNode?.status === "success" && curNode.url) {
        results.push({ index: idx, status: "success", videoUrl: curNode.url, firstFrameUrl: seg.firstFrameUrl });
        continue;
      }
      let firstFrameUrl;
      const segShots = curEp.shots.filter((s) => s.segmentIndex === idx);
      if (idx > 0 && seg.handoff === "continue") {
        const prevSeg = curEp.segments.find((s) => s.index === idx - 1);
        const prevNode = prevSeg?.videoNodeId ? curProj.nodes.find((n) => n.id === prevSeg.videoNodeId) : void 0;
        if (prevNode?.url) {
          const tail = await this.media.extractLastFrame(prevNode.url);
          if (tail) firstFrameUrl = tail;
        }
      }
      if (!firstFrameUrl && segShots[0]?.keyframeUrl) {
        firstFrameUrl = segShots[0].keyframeUrl;
      }
      const castRefs = collectSegmentCastRefs(curProj, curEp, seg);
      await this.store.updateDomain(projectId, (p) => {
        const target = p.drama?.episodes.find((e) => e.id === ep.id)?.segments.find((s) => s.index === idx);
        if (target) {
          target.status = "loading";
          target.error = void 0;
          if (firstFrameUrl) target.firstFrameUrl = firstFrameUrl;
        }
      }, false);
      const durationSec = Math.max(3, Math.min(12, Math.round(seg.durationMs / 1e3)));
      const { done } = await this.startGeneration({
        projectId,
        kind: "video",
        nodeId: seg.videoNodeId,
        title: seg.title,
        prompt: seg.prompt,
        duration: durationSec,
        ratio: curDrama.aspectRatio,
        firstFrameUrl,
        extraRefUrls: castRefs
      }, signal);
      const finalNode = await done;
      await this.store.updateDomain(projectId, (p) => {
        const target = p.drama?.episodes.find((e) => e.id === ep.id)?.segments.find((s) => s.index === idx);
        if (target) {
          target.status = finalNode.status ?? "error";
          target.error = finalNode.error || void 0;
        }
      }, false);
      results.push({
        index: idx,
        status: finalNode.status ?? "error",
        videoUrl: finalNode.url,
        firstFrameUrl,
        error: finalNode.error || void 0
      });
      if (finalNode.status !== "success") break;
    }
    return { episodeId: ep.id, segments: results };
  }
  /** 将某集的全部已完成分段推送到项目时间线，并可立即用 FFmpeg 合成单集成片。 */
  async populateTimelineFromEpisode(projectId, episodeIdOrNum, autoRender = false) {
    const p = await this.store.get(projectId);
    const ep = p.drama?.episodes.find((e) => e.id === episodeIdOrNum || e.number === Number(episodeIdOrNum));
    if (!ep) throw new CanvasOpError(`\u627E\u4E0D\u5230\u5267\u96C6\uFF1A${String(episodeIdOrNum)}`);
    const clips = [];
    for (const seg of ep.segments) {
      const vNode = seg.videoNodeId ? p.nodes.find((n) => n.id === seg.videoNodeId) : void 0;
      if (!vNode?.url) continue;
      const segShots = ep.shots.filter((s) => s.segmentIndex === seg.index);
      const caption = segShots.filter((s) => s.dialogue?.trim()).map((s) => s.speaker && s.speaker !== "\u65C1\u767D" ? `${s.speaker}\uFF1A${s.dialogue.trim()}` : s.dialogue.trim()).join(" / ");
      const audioClips = [];
      let offsetMs = 0;
      for (const shot of segShots) {
        const shotDurMs = Math.max(1500, shot.durationMs || 3e3);
        if (shot.audioUrl) {
          const aNode = shot.audioNodeId ? p.nodes.find((n) => n.id === shot.audioNodeId) : void 0;
          audioClips.push({
            url: shot.audioUrl,
            ...shot.audioNodeId ? { nodeId: shot.audioNodeId } : {},
            startOffsetMs: offsetMs,
            durationMs: aNode?.durationMs ?? shotDurMs,
            ...shot.speaker ? { title: `${shot.speaker}\u914D\u97F3` } : {}
          });
        }
        offsetMs += shotDurMs;
      }
      const firstAudio = audioClips[0];
      clips.push({
        id: shortId("clip"),
        nodeId: vNode.id,
        title: seg.title,
        url: vNode.url,
        durationMs: vNode.durationMs ?? seg.durationMs,
        ...caption ? { caption } : {},
        ...firstAudio?.nodeId ? { audioNodeId: firstAudio.nodeId } : {},
        ...firstAudio?.url ? { audioUrl: firstAudio.url } : {},
        ...audioClips.length > 0 ? { audioClips } : {}
      });
    }
    if (clips.length === 0) throw new CanvasOpError(`\u7B2C${ep.number}\u96C6\u8FD8\u6CA1\u6709\u5DF2\u751F\u6210\u7684\u89C6\u9891\u7247\u6BB5`);
    const { srt } = buildEpisodeCaptions(ep);
    await this.store.updateDomain(projectId, (proj) => {
      proj.timeline = {
        clips,
        subtitleSrt: srt,
        status: "idle",
        updatedAt: Date.now()
      };
    });
    if (autoRender) {
      const rendered = await this.renderTimeline(projectId);
      await this.store.updateDomain(projectId, (proj) => {
        const target = proj.drama?.episodes.find((e) => e.id === ep.id);
        if (target && rendered.timeline?.outputUrl) {
          target.finalVideoUrl = rendered.timeline.outputUrl;
          target.subtitleSrt = rendered.timeline.subtitleSrt;
        }
      }, false);
      return this.store.get(projectId);
    }
    return this.store.get(projectId);
  }
  /* ───────────────────────── 时间线编排、FFmpeg 合成与剪映导出 ───────────────────────── */
  /** 保存时间线片段顺序与字幕；支持直接传画布视频节点 id 自动补全 URL 与时长。 */
  async saveTimeline(projectId, input) {
    const p = await this.store.get(projectId);
    const resolved = input.clips.map((item, idx) => {
      const vNode = item.nodeId ? p.nodes.find((n) => n.id === item.nodeId) : void 0;
      const url = item.url || vNode?.url;
      if (!url) throw new CanvasOpError(`\u65F6\u95F4\u7EBF\u7B2C ${idx + 1} \u6BB5\u7F3A\u5C11\u89C6\u9891\u5730\u5740`);
      const aNode = item.audioNodeId ? p.nodes.find((n) => n.id === item.audioNodeId) : void 0;
      const audioUrl = item.audioUrl || aNode?.url;
      const audioClips = [];
      if (Array.isArray(item.audioClips)) {
        for (const ac of item.audioClips) {
          const acNode = ac.nodeId ? p.nodes.find((n) => n.id === ac.nodeId) : void 0;
          const acUrl = ac.url || acNode?.url;
          if (!acUrl) continue;
          audioClips.push({
            url: acUrl,
            ...ac.nodeId ? { nodeId: ac.nodeId } : {},
            ...typeof ac.startOffsetMs === "number" && ac.startOffsetMs >= 0 ? { startOffsetMs: Math.round(ac.startOffsetMs) } : {},
            ...typeof ac.durationMs === "number" && ac.durationMs > 0 ? { durationMs: Math.round(ac.durationMs) } : {},
            ...ac.title ? { title: ac.title } : {}
          });
        }
      }
      return {
        id: item.id ?? shortId("clip"),
        ...item.nodeId ? { nodeId: item.nodeId } : {},
        title: item.title?.trim() || vNode?.title || `\u7247\u6BB5 ${idx + 1}`,
        url,
        durationMs: item.durationMs ?? vNode?.durationMs ?? 5e3,
        ...item.caption !== void 0 ? { caption: item.caption } : {},
        ...item.audioNodeId ? { audioNodeId: item.audioNodeId } : {},
        ...audioUrl ? { audioUrl } : {},
        ...audioClips.length > 0 ? { audioClips } : {}
      };
    });
    const captions = [];
    let cursorUs = 0;
    for (const c of resolved) {
      const durUs = Math.max(500, c.durationMs) * 1e3;
      if (c.caption?.trim()) {
        captions.push({ text: c.caption.trim(), startUs: cursorUs + 1e5, durationUs: Math.max(4e5, durUs - 2e5) });
      }
      cursorUs += durUs;
    }
    const subtitleSrt = buildSrt(captions);
    return this.store.updateDomain(projectId, (proj) => {
      const prev = proj.timeline ?? {};
      proj.timeline = {
        ...prev,
        clips: resolved,
        burnSubtitles: input.burnSubtitles ?? prev.burnSubtitles ?? false,
        subtitleSrt,
        status: "idle",
        error: void 0,
        updatedAt: Date.now()
      };
    });
  }
  /** 使用 FFmpeg 拼接时间线中的所有片段为完整 MP4 成片，同时落盘最新对齐的 SRT 字幕资产（支持硬烧录）。 */
  async renderTimeline(projectId) {
    const project = await this.store.get(projectId);
    const tl = project.timeline;
    if (!tl || tl.clips.length === 0) throw new CanvasOpError("\u65F6\u95F4\u7EBF\u4E3A\u7A7A\uFF1A\u8BF7\u5148\u4ECE\u753B\u5E03\u6216\u77ED\u5267\u96C6\u6DFB\u52A0\u89C6\u9891\u7247\u6BB5");
    await this.store.updateDomain(projectId, (p) => {
      if (p.timeline) {
        p.timeline.status = "loading";
        p.timeline.error = void 0;
      }
    }, false);
    try {
      const aspect = project.drama?.aspectRatio;
      const dims = aspect === "9:16" ? { width: 720, height: 1280 } : aspect === "1:1" ? { width: 1080, height: 1080 } : void 0;
      const renderClips = tl.clips.map((c) => ({
        ...c,
        ...c.audioClips ? { audioClips: c.audioClips.map((a) => ({ ...a })) } : {}
      }));
      const probedDurations = /* @__PURE__ */ new Map();
      const captions = [];
      let cursorUs = 0;
      for (const clip of renderClips) {
        const probed = await this.media.probeMedia(clip.url).catch(() => null);
        const durMs = probed?.durationMs ?? clip.durationMs;
        clip.durationMs = durMs;
        if (probed?.durationMs) {
          probedDurations.set(clip.id, { url: clip.url, durationMs: probed.durationMs });
        }
        const durUs = durMs * 1e3;
        if (clip.caption?.trim()) {
          captions.push({ text: clip.caption.trim(), startUs: cursorUs + 1e5, durationUs: Math.max(4e5, durUs - 2e5) });
        }
        cursorUs += durUs;
      }
      const srt = captions.length > 0 ? buildSrt(captions) : tl.subtitleSrt ?? "";
      const out = await this.media.concatVideos(renderClips, {
        ...dims,
        subtitleSrt: srt,
        burnSubtitles: Boolean(tl.burnSubtitles)
      });
      const subtitleAssetUrl = srt.trim() ? await this.media.saveAsset(Buffer.from(srt, "utf8"), ".srt") : void 0;
      return await this.store.updateDomain(projectId, (p) => {
        if (!p.timeline) return;
        for (const existing of p.timeline.clips) {
          const hit = probedDurations.get(existing.id);
          if (hit && existing.url === hit.url) {
            existing.durationMs = hit.durationMs;
          }
        }
        p.timeline.outputUrl = out.url;
        p.timeline.subtitleSrt = srt;
        p.timeline.subtitleAssetUrl = subtitleAssetUrl;
        p.timeline.status = "success";
        p.timeline.error = void 0;
        p.timeline.updatedAt = Date.now();
      }, false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.store.updateDomain(projectId, (p) => {
        if (p.timeline) {
          p.timeline.status = "error";
          p.timeline.error = msg;
        }
      }, false);
      throw error;
    }
  }
  /** 导出当前时间线到剪映专业版草稿目录（包含视频轨、配音音频轨与台词字幕轨）。 */
  async exportJianyingDraft(projectId, input) {
    const defaultRoot = defaultJianyingDraftRoot();
    const root = input.draftRoot?.trim() || defaultRoot;
    const project = await this.store.get(projectId);
    const tl = project.timeline;
    if (!tl || tl.clips.length === 0) throw new CanvasOpError("\u65F6\u95F4\u7EBF\u4E3A\u7A7A\uFF1A\u8BF7\u5148\u6DFB\u52A0\u89C6\u9891\u7247\u6BB5\u518D\u5BFC\u51FA\u526A\u6620\u8349\u7A3F");
    const jClips = [];
    const jAudios = [];
    const captions = [];
    let cursorUs = 0;
    let canvasW = project.drama?.aspectRatio === "9:16" ? 1080 : 1920;
    let canvasH = project.drama?.aspectRatio === "9:16" ? 1920 : 1080;
    for (const [idx, clip] of tl.clips.entries()) {
      const { file } = await this.media.ensureLocalFile(clip.url, ".mp4");
      const meta = await this.media.probeMedia(file).catch(() => ({
        durationMs: clip.durationMs || 5e3,
        width: canvasW,
        height: canvasH,
        hasAudio: false
      }));
      if (idx === 0 && meta.width > 0 && meta.height > 0) {
        canvasW = meta.width;
        canvasH = meta.height;
      }
      const ext = extname2(file) || ".mp4";
      const fileName = `${String(idx + 1).padStart(2, "0")}-${safeName(clip.title, `clip-${idx + 1}`, 40)}${ext}`;
      const durUs = Math.max(500, meta.durationMs) * 1e3;
      jClips.push({
        fileName,
        sourceFile: file,
        name: clip.title,
        durationUs: durUs,
        width: meta.width,
        height: meta.height
      });
      const clipAudios = clip.audioClips && clip.audioClips.length > 0 ? clip.audioClips : clip.audioUrl ? [{ url: clip.audioUrl, nodeId: clip.audioNodeId, startOffsetMs: 0, title: `${clip.title}-\u914D\u97F3` }] : [];
      for (const [aIdx, aud] of clipAudios.entries()) {
        if (!aud.url) continue;
        const { file: audioFile } = await this.media.ensureLocalFile(aud.url, ".mp3");
        const aMeta = await this.media.probeMedia(audioFile).catch(() => null);
        const aExt = extname2(audioFile) || ".mp3";
        const aName = aud.title || `${clip.title}-\u914D\u97F3${clipAudios.length > 1 ? aIdx + 1 : ""}`;
        const aFileName = `${String(idx + 1).padStart(2, "0")}-a${String(aIdx + 1).padStart(2, "0")}-${safeName(aName, `audio-${idx + 1}-${aIdx + 1}`, 32)}${aExt}`;
        const aStartUs = cursorUs + Math.max(0, Math.round(aud.startOffsetMs ?? 0)) * 1e3;
        const aDurUs = Math.max(200, aMeta?.durationMs ?? aud.durationMs ?? meta.durationMs) * 1e3;
        jAudios.push({
          fileName: aFileName,
          sourceFile: audioFile,
          name: aName,
          startUs: aStartUs,
          durationUs: aDurUs
        });
      }
      if (clip.caption?.trim()) {
        captions.push({
          text: clip.caption.trim(),
          startUs: cursorUs + 1e5,
          durationUs: Math.max(4e5, durUs - 2e5)
        });
      }
      cursorUs += durUs;
    }
    const res = await writeJianyingDraftToDisk({
      name: input.draftName?.trim() || `${project.title}-\u5E55\u5883\u8349\u7A3F`,
      root,
      width: canvasW,
      height: canvasH,
      fps: 30,
      clips: jClips,
      audios: jAudios,
      captions
    });
    return {
      ...res,
      draftDir: res.folderPath,
      clipCount: jClips.length,
      audioCount: jAudios.length,
      captionCount: captions.length,
      defaultRoot,
      defaultMacRoot: defaultRoot
    };
  }
};

// mujing/canvas/src/host/web.ts
var web_exports = {};
__export(web_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name,
  parseByteRange: () => parseByteRange
});
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname as extname3, join as join5 } from "node:path";
var name = "mujing-web";
var inject = ["mujing", "webServer"];
var API = "/mujing/api";
var MAX_JSON_BODY = 10 * 1024 * 1024;
var MAX_UPLOAD_BODY = 80 * 1024 * 1024;
var HttpError = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}
async function readBody(req, maxBytes = MAX_JSON_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, "\u8BF7\u6C42\u4F53\u8FC7\u5927");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "\u8BF7\u6C42\u4F53\u5FC5\u987B\u662F JSON \u5BF9\u8C61");
  }
}
async function readRawBytes(req, maxBytes = MAX_UPLOAD_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, "\u4E0A\u4F20\u6587\u4EF6\u8FC7\u5927\uFF08\u4E0A\u9650 80MB\uFF09");
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
function statusOf(error) {
  if (error instanceof HttpError) return error.status;
  if (error instanceof ProjectNotFoundError) return 404;
  if (error instanceof CanvasOpError) return 400;
  if (error instanceof MediaConfigError) return 412;
  if (error instanceof MediaUpstreamError) return 502;
  return 500;
}
function parseByteRange(header, totalSize) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return { kind: "ignore" };
  const [, rawStart, rawEnd] = m;
  if (!rawStart && !rawEnd) return { kind: "unsatisfiable" };
  if (totalSize <= 0) return { kind: "unsatisfiable" };
  if (!rawStart) {
    const suffix = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: "unsatisfiable" };
    const start2 = Math.max(0, totalSize - suffix);
    return { kind: "ok", start: start2, end: totalSize - 1 };
  }
  const start = Number.parseInt(rawStart, 10);
  if (!Number.isFinite(start) || start < 0 || start >= totalSize) return { kind: "unsatisfiable" };
  const end = rawEnd ? Math.min(totalSize - 1, Number.parseInt(rawEnd, 10)) : totalSize - 1;
  if (!Number.isFinite(end) || end < start) return { kind: "unsatisfiable" };
  return { kind: "ok", start, end };
}
function apply(ctx) {
  const mujing = ctx.mujing;
  const api = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const parts = url.pathname.slice(API.length).split("/").filter(Boolean);
    const method = req.method ?? "GET";
    try {
      if (parts[0] === "config" && parts.length === 1 && method === "GET") {
        send(res, 200, { ...mujing.media.status(), activeProjectId: mujing.activeProjectId ?? null });
        return;
      }
      if (parts[0] === "media-config" && parts.length === 1 && method === "GET") {
        send(res, 200, mujing.media.getConfigDetails());
        return;
      }
      if (parts[0] === "media-config" && parts.length === 1 && method === "PUT") {
        const body = await readBody(req);
        const out = await mujing.media.updateConfig(body);
        send(res, 200, { ...out.status, config: out.config });
        return;
      }
      if (parts[0] === "media-config" && parts[1] === "reset" && parts.length === 2 && method === "POST") {
        const body = await readBody(req);
        const kind = body.kind === "image" || body.kind === "video" || body.kind === "audio" ? body.kind : void 0;
        const out = await mujing.media.resetConfig(kind);
        send(res, 200, { ...out.status, config: out.config });
        return;
      }
      if (parts[0] === "media-config" && parts[1] === "reset-health" && parts.length === 2 && method === "POST") {
        const body = await readBody(req);
        const kind = body.kind === "image" || body.kind === "video" || body.kind === "audio" ? body.kind : void 0;
        const out = mujing.media.resetHealth(kind);
        send(res, 200, { ...out.status, config: out.config });
        return;
      }
      if (parts[0] === "active" && parts.length === 1 && method === "PUT") {
        const body = await readBody(req);
        const id2 = typeof body.projectId === "string" ? body.projectId : void 0;
        if (id2 !== void 0) await mujing.store.get(id2);
        mujing.activeProjectId = id2;
        send(res, 200, { activeProjectId: id2 ?? null });
        return;
      }
      if (parts[0] === "assets" && parts[1] === "upload" && parts.length === 2 && method === "POST") {
        const ct = req.headers["content-type"] ?? "";
        const filenameParam = url.searchParams.get("filename") ?? "";
        if (ct.includes("application/json")) {
          const body = await readBody(req, MAX_UPLOAD_BODY);
          const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
          const fileName = typeof body.filename === "string" ? body.filename : filenameParam;
          const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
          if (!m) throw new HttpError(400, "\u65E0\u6548\u7684 dataUrl");
          const bytes = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
          const ext2 = extname3(fileName) || extFromMime(m[1] ?? null, ".bin");
          const assetUrl2 = await mujing.media.saveAsset(bytes, ext2);
          const probed2 = await mujing.media.probeMedia(assetUrl2).catch(() => null);
          send(res, 201, { url: assetUrl2, ...probed2 ? { meta: probed2 } : {} });
          return;
        }
        const raw = await readRawBytes(req);
        if (raw.byteLength === 0) throw new HttpError(400, "\u4E0A\u4F20\u6587\u4EF6\u5185\u5BB9\u4E3A\u7A7A");
        const ext = extname3(filenameParam) || extFromMime(ct || null, ".bin");
        const assetUrl = await mujing.media.saveAsset(raw, ext);
        const probed = await mujing.media.probeMedia(assetUrl).catch(() => null);
        send(res, 201, { url: assetUrl, ...probed ? { meta: probed } : {} });
        return;
      }
      if (parts[0] !== "projects") throw new HttpError(404, "\u672A\u77E5\u63A5\u53E3");
      if (parts.length === 1) {
        if (method === "GET") {
          send(res, 200, await mujing.store.list());
          return;
        }
        if (method === "POST") {
          const body = await readBody(req);
          const created = await mujing.store.create(typeof body.title === "string" ? body.title : "");
          mujing.activeProjectId = created.id;
          if (typeof body.aspectRatio === "string" || typeof body.style === "string" || typeof body.genre === "string") {
            const aspectRatio = body.aspectRatio === "9:16" || body.aspectRatio === "1:1" || body.aspectRatio === "16:9" ? body.aspectRatio : void 0;
            const withDrama = await mujing.saveDrama(created.id, {
              genre: typeof body.genre === "string" ? body.genre : void 0,
              style: typeof body.style === "string" ? body.style : void 0,
              aspectRatio,
              syncCanvasNodes: false
            });
            send(res, 201, withDrama);
            return;
          }
          send(res, 201, created);
          return;
        }
        throw new HttpError(405, "\u4E0D\u652F\u6301\u7684\u65B9\u6CD5");
      }
      if (parts[1] === "import" && parts.length === 2 && method === "POST") {
        const body = await readBody(req);
        const payload = typeof body.project === "object" && body.project !== null ? body.project : body;
        const imported = await mujing.store.importProject(payload);
        mujing.activeProjectId = imported.id;
        send(res, 201, imported);
        return;
      }
      const id = parts[1];
      if (parts.length === 2) {
        if (method === "GET") {
          const project = await mujing.store.get(id);
          send(res, 200, { ...project, history: mujing.store.historyStatus(id) });
          return;
        }
        if (method === "PATCH") {
          const body = await readBody(req);
          send(res, 200, await mujing.store.rename(id, typeof body.title === "string" ? body.title : ""));
          return;
        }
        if (method === "DELETE") {
          await mujing.store.remove(id);
          if (mujing.activeProjectId === id) mujing.activeProjectId = void 0;
          send(res, 200, { ok: true });
          return;
        }
        throw new HttpError(405, "\u4E0D\u652F\u6301\u7684\u65B9\u6CD5");
      }
      if (parts[2] === "export" && parts.length === 3 && method === "GET") {
        const project = await mujing.store.get(id);
        const filename = encodeURIComponent(`${project.title || project.id}.mujing.json`);
        const text = JSON.stringify(project, null, 2);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename*=UTF-8''${filename}`,
          "cache-control": "no-store"
        });
        res.end(text);
        return;
      }
      if (parts[2] === "ops" && parts.length === 3 && method === "POST") {
        const body = await readBody(req);
        if (!Array.isArray(body.ops)) throw new HttpError(400, "ops \u5FC5\u987B\u662F\u6570\u7EC4");
        const { project, created } = await mujing.store.apply(id, body.ops);
        send(res, 200, { project, created, history: mujing.store.historyStatus(id) });
        return;
      }
      if (parts[2] === "undo" && parts.length === 3 && method === "POST") {
        const out = await mujing.store.undo(id);
        send(res, 200, { ...out, history: mujing.store.historyStatus(id) });
        return;
      }
      if (parts[2] === "redo" && parts.length === 3 && method === "POST") {
        const out = await mujing.store.redo(id);
        send(res, 200, { ...out, history: mujing.store.historyStatus(id) });
        return;
      }
      if (parts[2] === "generate" && parts.length === 3 && method === "POST") {
        const body = await readBody(req);
        const kind = body.kind === "video" ? "video" : body.kind === "image" ? "image" : body.kind === "audio" ? "audio" : void 0;
        if (kind === void 0) throw new HttpError(400, "kind \u5FC5\u987B\u662F image\u3001video \u6216 audio");
        if (typeof body.prompt !== "string" || body.prompt.trim() === "") throw new HttpError(400, "\u63D0\u793A\u8BCD/\u53F0\u8BCD\u4E0D\u80FD\u4E3A\u7A7A");
        const { nodeId } = await mujing.startGeneration({
          projectId: id,
          kind,
          prompt: body.prompt,
          nodeId: typeof body.nodeId === "string" ? body.nodeId : void 0,
          title: typeof body.title === "string" ? body.title : void 0,
          voice: typeof body.voice === "string" ? body.voice : void 0,
          size: typeof body.size === "string" ? body.size : void 0,
          duration: typeof body.duration === "number" ? body.duration : void 0,
          ratio: typeof body.ratio === "string" ? body.ratio : void 0,
          referenceNodeIds: Array.isArray(body.referenceNodeIds) ? body.referenceNodeIds.filter((x) => typeof x === "string") : void 0
        });
        send(res, 202, { nodeId });
        return;
      }
      if (parts[2] === "cancel" && parts.length === 3 && method === "POST") {
        const body = await readBody(req);
        send(res, 200, { cancelled: typeof body.nodeId === "string" && mujing.cancelGeneration(body.nodeId) });
        return;
      }
      if (parts[2] === "drama" && parts.length === 3 && method === "PUT") {
        const body = await readBody(req);
        const aspectRatio = body.aspectRatio === "9:16" || body.aspectRatio === "1:1" || body.aspectRatio === "16:9" ? body.aspectRatio : void 0;
        const project = await mujing.saveDrama(id, {
          genre: typeof body.genre === "string" ? body.genre : void 0,
          logline: typeof body.logline === "string" ? body.logline : void 0,
          style: typeof body.style === "string" ? body.style : void 0,
          aspectRatio,
          language: typeof body.language === "string" ? body.language : void 0,
          segmentTargetSec: typeof body.segmentTargetSec === "number" ? body.segmentTargetSec : void 0,
          novelText: typeof body.novelText === "string" ? body.novelText : void 0,
          casts: Array.isArray(body.casts) ? body.casts : void 0,
          episodes: Array.isArray(body.episodes) ? body.episodes : void 0,
          syncCanvasNodes: body.syncCanvasNodes !== false
        });
        send(res, 200, project);
        return;
      }
      if (parts[2] === "drama" && parts[3] === "sync-canvas" && parts.length === 4 && method === "POST") {
        send(res, 200, await mujing.syncDramaToCanvas(id));
        return;
      }
      if (parts[2] === "drama" && parts[3] === "generate-casts" && parts.length === 4 && method === "POST") {
        const body = await readBody(req);
        const castId = typeof body.castId === "string" ? body.castId : void 0;
        const out = await mujing.generateDramaCastImage(id, castId);
        send(res, 200, out);
        return;
      }
      if (parts[2] === "drama" && parts[3] === "shot" && parts.length === 4 && method === "PATCH") {
        const body = await readBody(req);
        const ep = typeof body.episode === "number" || typeof body.episode === "string" ? body.episode : 1;
        const project = await mujing.updateDramaShot(id, ep, {
          shotId: typeof body.shotId === "string" ? body.shotId : void 0,
          shotIndex: typeof body.shotIndex === "number" ? body.shotIndex : void 0,
          delete: Boolean(body.delete),
          resegment: Boolean(body.resegment),
          patch: typeof body.patch === "object" && body.patch !== null ? body.patch : void 0
        });
        send(res, 200, project);
        return;
      }
      if (parts[2] === "drama" && parts[3] === "shot-media" && parts.length === 4 && method === "POST") {
        const body = await readBody(req);
        const ep = typeof body.episode === "number" || typeof body.episode === "string" ? body.episode : 1;
        const kind = body.kind === "audio" ? "audio" : "keyframe";
        const out = await mujing.generateDramaShotMedia(id, ep, {
          kind,
          shotId: typeof body.shotId === "string" ? body.shotId : void 0,
          shotIndex: typeof body.shotIndex === "number" ? body.shotIndex : void 0
        });
        send(res, 200, out);
        return;
      }
      if (parts[2] === "drama" && parts[3] === "segment" && parts.length === 4 && method === "PATCH") {
        const body = await readBody(req);
        const episodeId = typeof body.episodeId === "string" || typeof body.episodeId === "number" ? String(body.episodeId) : "";
        const segmentIndex = typeof body.segmentIndex === "number" ? body.segmentIndex : -1;
        if (!episodeId || segmentIndex < 0) throw new HttpError(400, "\u9700\u8981\u63D0\u4F9B episodeId \u4E0E segmentIndex");
        const handoff = body.handoff === "continue" || body.handoff === "reverse_angle" || body.handoff === "scene_cut" ? body.handoff : void 0;
        const project = await mujing.updateDramaSegment(id, episodeId, segmentIndex, {
          handoff,
          prompt: typeof body.prompt === "string" ? body.prompt : void 0
        });
        send(res, 200, project);
        return;
      }
      if (parts[2] === "drama" && parts[3] === "run-episode" && parts.length === 4 && method === "POST") {
        const body = await readBody(req);
        const ep = typeof body.episode === "number" || typeof body.episode === "string" ? body.episode : 1;
        const out = await mujing.runDramaEpisode(id, ep, {
          segmentIndex: typeof body.segmentIndex === "number" ? body.segmentIndex : void 0,
          forceRegenerate: Boolean(body.forceRegenerate)
        });
        send(res, 200, out);
        return;
      }
      if (parts[2] === "drama" && parts[3] === "to-timeline" && parts.length === 4 && method === "POST") {
        const body = await readBody(req);
        const ep = typeof body.episode === "number" || typeof body.episode === "string" ? body.episode : 1;
        const project = await mujing.populateTimelineFromEpisode(id, ep, Boolean(body.autoRender));
        send(res, 200, project);
        return;
      }
      if (parts[2] === "timeline" && parts.length === 3 && method === "PUT") {
        const body = await readBody(req);
        if (!Array.isArray(body.clips)) throw new HttpError(400, "clips \u5FC5\u987B\u662F\u6570\u7EC4");
        const project = await mujing.saveTimeline(id, {
          clips: body.clips,
          burnSubtitles: typeof body.burnSubtitles === "boolean" ? body.burnSubtitles : void 0
        });
        send(res, 200, project);
        return;
      }
      if (parts[2] === "timeline" && parts[3] === "render" && parts.length === 4 && method === "POST") {
        const project = await mujing.renderTimeline(id);
        send(res, 200, project);
        return;
      }
      if (parts[2] === "timeline" && parts[3] === "export-jianying" && parts.length === 4 && method === "POST") {
        const body = await readBody(req);
        const out = await mujing.exportJianyingDraft(id, {
          draftRoot: typeof body.draftRoot === "string" ? body.draftRoot : void 0,
          draftName: typeof body.draftName === "string" ? body.draftName : void 0
        });
        send(res, 200, out);
        return;
      }
      if (parts[2] === "events" && parts.length === 3 && method === "GET") {
        const first = await mujing.store.get(id);
        const LF = String.fromCharCode(10);
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
          "x-accel-buffering": "no"
        });
        const push = (event, data) => {
          res.write(`event: ${event}${LF}data: ${JSON.stringify(data)}${LF}${LF}`);
        };
        push("snapshot", { ...first, history: mujing.store.historyStatus(id) });
        const onChange = (p) => {
          if (p.id === id) push("snapshot", { ...p, history: mujing.store.historyStatus(id) });
        };
        const onDelete = (deleted) => {
          if (deleted === id) {
            push("deleted", { id });
            res.end();
          }
        };
        const heartbeat = setInterval(() => res.write(`: ping${LF}${LF}`), 15e3);
        const cleanup = () => {
          clearInterval(heartbeat);
          mujing.store.events.off("change", onChange);
          mujing.store.events.off("delete", onDelete);
        };
        mujing.store.events.on("change", onChange);
        mujing.store.events.on("delete", onDelete);
        req.on("close", cleanup);
        return;
      }
      throw new HttpError(404, "\u672A\u77E5\u63A5\u53E3");
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      send(res, statusOf(error), { error: error instanceof Error ? error.message : String(error) });
    }
  };
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: API, handler: (req, res) => api(req, res) }));
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: ASSET_PREFIX.slice(0, -1),
    handler: async (req, res) => {
      const BS2 = String.fromCharCode(92);
      let name3;
      try {
        name3 = decodeURIComponent(new URL(req.url ?? "/", "http://local").pathname.slice(ASSET_PREFIX.length));
      } catch {
        send(res, 400, { error: "\u975E\u6CD5\u8DEF\u5F84\u7F16\u7801" });
        return;
      }
      if (!name3 || name3.includes("/") || name3.includes(BS2) || name3.includes("..")) {
        send(res, 400, { error: "\u975E\u6CD5\u8DEF\u5F84" });
        return;
      }
      const file = join5(mujing.media.assetsDir, name3);
      try {
        const info = await stat(file);
        const mime = mimeOf(name3);
        const range = req.headers.range;
        if (range) {
          const parsed = parseByteRange(range, info.size);
          if (parsed.kind === "unsatisfiable") {
            res.writeHead(416, {
              "content-range": `bytes */${info.size}`,
              "accept-ranges": "bytes"
            });
            res.end();
            return;
          }
          if (parsed.kind === "ok") {
            const { start, end } = parsed;
            res.writeHead(206, {
              "content-type": mime,
              "content-range": `bytes ${start}-${end}/${info.size}`,
              "accept-ranges": "bytes",
              "content-length": String(end - start + 1),
              "cache-control": "private, max-age=31536000, immutable"
            });
            if (req.method === "HEAD") {
              res.end();
              return;
            }
            createReadStream(file, { start, end }).pipe(res);
            return;
          }
        }
        res.writeHead(200, {
          "content-type": mime,
          "accept-ranges": "bytes",
          "content-length": String(info.size),
          "cache-control": "private, max-age=31536000, immutable"
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        createReadStream(file).pipe(res);
      } catch {
        send(res, 404, { error: "\u8D44\u4EA7\u4E0D\u5B58\u5728" });
      }
    }
  }));
}

// mujing/canvas/src/host/index.ts
var name2 = "mujing";
function apply2(ctx, config) {
  ctx.plugin(MujingService, config);
  ctx.plugin(web_exports);
}
export {
  Config,
  MujingService,
  apply2 as apply,
  name2 as name
};
//# sourceMappingURL=index.js.map
