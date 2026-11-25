// src/tools.ts
import { createUserMessage, HarnessError } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";

// src/host/digest.ts
function digestProject(project) {
  return {
    project_id: project.id,
    title: project.title,
    rev: project.rev,
    nodes: project.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      x: Math.round(n.x),
      y: Math.round(n.y),
      w: n.width,
      h: n.height,
      ...n.content !== void 0 ? { content: n.content } : {},
      ...n.prompt !== void 0 ? { prompt: n.prompt } : {},
      ...n.voice !== void 0 ? { voice: n.voice } : {},
      ...n.url ? { url: n.url } : {},
      status: n.status ?? "idle",
      ...n.error ? { error: n.error } : {},
      ...n.model ? { model: n.model } : {},
      ...n.durationMs ? { durationMs: n.durationMs } : {}
    })),
    edges: project.edges.map((e) => [e.source, e.target]),
    ...project.drama ? {
      drama: {
        ...project.drama.genre ? { genre: project.drama.genre } : {},
        ...project.drama.logline ? { logline: project.drama.logline } : {},
        style: project.drama.style,
        aspectRatio: project.drama.aspectRatio,
        language: project.drama.language,
        segmentTargetSec: project.drama.segmentTargetSec,
        hasNovel: Boolean(project.drama.novelText),
        casts: project.drama.casts.map((c) => ({
          id: c.id,
          kind: c.kind,
          name: c.name,
          role: c.role,
          appearance: c.appearance,
          voice: c.voice,
          imageNodeId: c.imageNodeId,
          imageUrl: c.imageUrl,
          locked: Boolean(c.locked)
        })),
        episodes: project.drama.episodes.map((ep) => ({
          id: ep.id,
          number: ep.number,
          title: ep.title,
          synopsis: ep.synopsis,
          shotCount: ep.shots.length,
          shots: ep.shots.map((sh, idx) => ({
            id: sh.id,
            number: idx + 1,
            segmentIndex: sh.segmentIndex,
            scene: sh.scene,
            shotSize: sh.shotSize,
            camera: sh.camera,
            action: sh.action,
            ...sh.speaker ? { speaker: sh.speaker } : {},
            ...sh.dialogue ? { dialogue: sh.dialogue } : {},
            ...sh.keyframeUrl ? { keyframeUrl: sh.keyframeUrl } : {},
            ...sh.audioUrl ? { audioUrl: sh.audioUrl } : {}
          })),
          segments: ep.segments.map((s) => ({
            index: s.index,
            title: s.title,
            handoff: s.handoff,
            durationMs: s.durationMs,
            status: s.status,
            videoNodeId: s.videoNodeId,
            firstFrameUrl: s.firstFrameUrl
          })),
          finalVideoUrl: ep.finalVideoUrl
        }))
      }
    } : {},
    ...project.timeline ? {
      timeline: {
        clipCount: project.timeline.clips.length,
        clips: project.timeline.clips.map((c) => ({ id: c.id, nodeId: c.nodeId, title: c.title, url: c.url, durationMs: c.durationMs, caption: c.caption })),
        status: project.timeline.status ?? "idle",
        outputUrl: project.timeline.outputUrl
      }
    } : {}
  };
}

// src/tools.ts
var name = "mujing-tools";
var inject = ["tools", "mujing", "agents"];
function formatStudioContext(p, mediaReady) {
  const lines = ["<mujing_studio_context>"];
  lines.push(`\u5A92\u4F53\u5F15\u64CE\u72B6\u6001\uFF1A\u751F\u56FE=${mediaReady.image ? "\u5C31\u7EEA" : "\u672A\u914D\u7F6E"}\uFF5C\u751F\u89C6\u9891=${mediaReady.video ? "\u5C31\u7EEA" : "\u672A\u914D\u7F6E"}\uFF5C\u914D\u97F3TTS=${mediaReady.audio ? "\u5C31\u7EEA" : "\u672A\u914D\u7F6E"}`);
  if (!p) {
    lines.push("\u5F53\u524D\u6D3B\u52A8\u9879\u76EE\uFF1A\u65E0\uFF08\u8BF7\u5148\u8C03\u7528 canvas_create_project \u65B0\u5EFA\u77ED\u5267/\u5F71\u89C6\u9879\u76EE\uFF09");
  } else {
    lines.push(`\u5F53\u524D\u6D3B\u52A8\u9879\u76EE\uFF1A\u300A${p.title}\u300B\uFF08project_id: ${p.id}\uFF0C\u4FEE\u8BA2 rev=${p.rev}\uFF0C\u753B\u5E03\u8282\u70B9=${p.nodes.length}\uFF09`);
    if (p.drama) {
      const lockedCount = p.drama.casts.filter((c) => c.locked && c.imageUrl).length;
      lines.push(`\u77ED\u5267\u8BBE\u5B9A\uFF1A\u753B\u5E45=${p.drama.aspectRatio}\uFF5C\u753B\u98CE=${p.drama.style}\uFF5C\u89D2\u8272/\u573A\u666F\u8D44\u4EA7=${p.drama.casts.length}\uFF08\u5DF2\u9501\u5B9A\u4E09\u89C6\u56FE=${lockedCount}\uFF09\uFF5C\u5267\u96C6\u6570=${p.drama.episodes.length}`);
      for (const ep of p.drama.episodes.slice(0, 5)) {
        const doneSegs = ep.segments.filter((s) => s.status === "success").length;
        const kfCount = ep.shots.filter((s) => s.keyframeUrl).length;
        const ttsCount = ep.shots.filter((s) => s.audioUrl).length;
        lines.push(`- \u7B2C${ep.number}\u96C6\u300A${ep.title}\u300B\uFF1A${ep.shots.length}\u955C\uFF08\u5173\u952E\u5E27=${kfCount}\uFF0C\u914D\u97F3=${ttsCount}\uFF09\uFF5C\u89C6\u9891\u6BB5=${doneSegs}/${ep.segments.length}\u5DF2\u5B8C\u6210${ep.finalVideoUrl ? "\uFF5C\u6574\u96C6\u6210\u7247\u5DF2\u5C31\u7EEA" : ""}`);
      }
    }
    if (p.timeline) {
      lines.push(`\u65F6\u95F4\u7EBF\u72B6\u6001\uFF1A\u7247\u6BB5=${p.timeline.clips.length}\uFF5C\u5408\u6210\u72B6\u6001=${p.timeline.status ?? "idle"}${p.timeline.outputUrl ? `\uFF5C\u6210\u7247=${p.timeline.outputUrl}` : ""}`);
    }
  }
  lines.push("</mujing_studio_context>");
  return lines.join("\n");
}
async function guard(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw error;
    const code = error.code;
    throw new HarnessError(error instanceof Error ? error.message : String(error), typeof code === "string" ? code : "MUJING_ERROR");
  }
}
var json = (value) => [{ type: "text", text: JSON.stringify(value, null, 1) }];
var NODE_FIELDS = {
  id: { type: "string", description: "add_node \u53EF\u9009\u81EA\u5B9A\u4E49 id\uFF1B\u5176\u5B83\u64CD\u4F5C\u4E3A\u76EE\u6807\u8282\u70B9 id" },
  type: { type: "string", enum: ["text", "image", "video", "audio"], description: "add_node \u7684\u8282\u70B9\u7C7B\u578B" },
  source: { type: "string", description: "connect/disconnect \u7684\u6E90\u8282\u70B9 id\uFF08\u4E0A\u6E38\uFF0C\u5982\u53C2\u8003\u56FE\uFF09" },
  target: { type: "string", description: "connect/disconnect \u7684\u76EE\u6807\u8282\u70B9 id" },
  x: { type: "number" },
  y: { type: "number" },
  width: { type: "number" },
  height: { type: "number" },
  title: { type: "string" },
  content: { type: "string", description: "\u6587\u672C\u8282\u70B9\u6B63\u6587\uFF08\u5267\u672C\u3001\u5206\u955C\u8868\u3001\u4EBA\u8BBE\u7B49\uFF0C\u652F\u6301 Markdown\uFF09" },
  prompt: { type: "string", description: "\u56FE\u7247/\u89C6\u9891\u8282\u70B9\u7684\u751F\u6210\u63D0\u793A\u8BCD\uFF0C\u6216\u97F3\u9891\u8282\u70B9\u7684\u5F85\u6717\u8BFB\u53F0\u8BCD" },
  voice: { type: "string", description: "\u97F3\u9891\u8282\u70B9\u7684\u97F3\u8272\uFF08\u5982 alloy / nova / shimmer / onyx\uFF09" },
  url: { type: "string", description: "\u5DF2\u6709\u5A92\u4F53\u5730\u5740" }
};
function apply(ctx) {
  const mujing = ctx.mujing;
  const lastInjectedSig = /* @__PURE__ */ new WeakMap();
  ctx.on("agent/pre-step", async ({ agent, step, signal }, next) => {
    const decision = await next();
    if (decision.kind === "reject" || signal.aborted || step !== 1) return decision;
    try {
      const mStatus = mujing.media.status();
      let activeProj = null;
      if (mujing.activeProjectId) {
        activeProj = await mujing.store.get(mujing.activeProjectId).catch(() => null);
      }
      if (!activeProj) {
        const [latest] = await mujing.store.list();
        if (latest) activeProj = await mujing.store.get(latest.id).catch(() => null);
      }
      const text = formatStudioContext(activeProj, {
        image: mStatus.image.ready,
        video: mStatus.video.ready,
        audio: mStatus.audio.ready
      });
      if (lastInjectedSig.get(agent.session) === text) return decision;
      lastInjectedSig.set(agent.session, text);
      return {
        ...decision,
        messages: [
          ...decision.messages,
          createUserMessage({
            content: [{ type: "text", text }],
            source: { kind: "mujing-studio", form: "snapshot", sections: [{ name: "mujing-studio", text }] }
          })
        ]
      };
    } catch {
      return decision;
    }
  }, { prepend: true });
  ctx.tools.register(defineTool({
    name: "canvas_list_projects",
    description: "\u5217\u51FA\u5E55\u5883\u753B\u5E03\u9879\u76EE\uFF08\u6309\u6700\u8FD1\u66F4\u65B0\u6392\u5E8F\uFF09\uFF0C\u5E76\u6807\u51FA\u7528\u6237\u5F53\u524D\u5728\u754C\u9762\u4E0A\u6253\u5F00\u7684\u753B\u5E03\u3002",
    parameters: {},
    output: { schema: { type: "json" }, render: (_a, v) => json(v) },
    async execute() {
      return guard(async () => ({
        active_project_id: mujing.activeProjectId ?? null,
        projects: (await mujing.store.list()).map((p) => ({ ...p }))
      }));
    }
  }));
  ctx.tools.register(defineTool({
    name: "canvas_create_project",
    description: "\u65B0\u5EFA\u4E00\u4E2A\u5E55\u5883\u753B\u5E03\u9879\u76EE\uFF0C\u5E76\u628A\u5B83\u8BBE\u4E3A\u5F53\u524D\u753B\u5E03\u3002",
    parameters: { title: { type: "string", required: true, description: "\u753B\u5E03\u6807\u9898" } },
    output: { schema: { type: "json" }, render: (_a, v) => json(v) },
    async execute(args) {
      return guard(async () => {
        const p = await mujing.store.create(args.title);
        mujing.activeProjectId = p.id;
        return { project_id: p.id, title: p.title };
      });
    }
  }));
  ctx.tools.register(defineTool({
    name: "canvas_get_state",
    description: "\u8BFB\u53D6\u753B\u5E03\u7684\u5168\u90E8\u8282\u70B9\u3001\u8FDE\u7EBF\u3001\u77ED\u5267\u6D41\u6C34\u7EBF\u72B6\u6001\uFF08\u89D2\u8272\u9501\u5B9A/\u5206\u96C6\u5206\u6BB5\uFF09\u53CA\u65F6\u95F4\u7EBF\u72B6\u6001\u3002\u4FEE\u6539\u753B\u5E03\u524D\u5148\u8C03\u7528\u3002project_id \u7F3A\u7701\u65F6\u8BFB\u53D6\u7528\u6237\u5F53\u524D\u6253\u5F00\u7684\u753B\u5E03\u3002",
    parameters: { project_id: { type: "string" } },
    output: { schema: { type: "json" }, render: (_a, v) => json(v) },
    async execute(args) {
      return guard(async () => digestProject(await mujing.store.get(await mujing.resolveProjectId(args.project_id))));
    }
  }));
  ctx.tools.register(defineTool({
    name: "canvas_apply_ops",
    description: [
      "\u6279\u91CF\u4FEE\u6539\u753B\u5E03\uFF0C\u6574\u7EC4\u539F\u5B50\u751F\u6548\uFF08\u4EFB\u4E00\u64CD\u4F5C\u5931\u8D25\u5219\u5168\u90E8\u4E0D\u751F\u6548\uFF09\u3002\u64CD\u4F5C\u7C7B\u578B op\uFF1A",
      "add_node\uFF08type \u5FC5\u586B\uFF1Atext/image/video/audio\uFF1B\u4E0D\u586B\u5750\u6807\u5219\u81EA\u52A8\u6392\u5230\u53F3\u4FA7\uFF09\u3001update_node\uFF08id \u5FC5\u586B\uFF09\u3001delete_node\uFF08id\uFF09\u3001",
      "connect / disconnect\uFF08source \u2192 target\uFF0C\u8868\u793A\u4E0A\u6E38\u7D20\u6750\u6D41\u5411\u4E0B\u6E38\uFF0C\u4F8B\u5982\u89D2\u8272\u56FE \u2192 \u5206\u955C\u56FE\uFF09\u3002",
      "\u7528 text \u8282\u70B9\u627F\u8F7D\u5267\u672C\u3001\u5206\u955C\u8868\u3001\u89D2\u8272\u8BBE\u5B9A\uFF1Bimage/video/audio \u8282\u70B9\u5199\u597D prompt \u540E\u7528 generate_media \u751F\u6210\u3002"
    ].join(""),
    parameters: {
      project_id: { type: "string" },
      ops: {
        type: "array",
        required: true,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            op: { type: "string", required: true, enum: ["add_node", "update_node", "delete_node", "connect", "disconnect"] },
            ...NODE_FIELDS
          }
        }
      }
    },
    output: { schema: { type: "json" }, render: (_a, v) => json(v) },
    async execute(args) {
      return guard(async () => {
        const id = await mujing.resolveProjectId(args.project_id);
        const { project, created } = await mujing.store.apply(id, args.ops);
        return { project_id: id, rev: project.rev, created_node_ids: created, node_count: project.nodes.length };
      });
    }
  }));
  ctx.tools.register(defineTool({
    name: "generate_media",
    description: [
      "\u5728\u753B\u5E03\u4E0A\u751F\u6210\u56FE\u7247\uFF08image\uFF09\u3001\u89C6\u9891\uFF08video\uFF09\u6216\u8BED\u97F3\u914D\u97F3\uFF08audio\uFF09\u3002\u7ED9 node_id \u5219\u5728\u8BE5\u8282\u70B9\u4E0A\uFF08\u91CD\u65B0\uFF09\u751F\u6210\uFF0C\u5426\u5219\u65B0\u5EFA\u8282\u70B9\u3002",
      "reference_node_ids\uFF1A\u56FE\u7247\u751F\u6210\u65F6\u4F5C\u4E3A\u53C2\u8003\u56FE\uFF08\u4FDD\u6301\u89D2\u8272/\u573A\u666F\u4E00\u81F4\uFF09\uFF0C\u89C6\u9891\u751F\u6210\u65F6\u7B2C\u4E00\u4E2A\u4F5C\u4E3A\u9996\u5E27\u3001\u5176\u4F59\u4F5C\u4E3A\u53C2\u8003\u56FE\u3002",
      "audio \u751F\u6210\uFF1Aprompt \u586B\u5199\u8981\u6717\u8BFB\u7684\u53F0\u8BCD\u6216\u65C1\u767D\uFF0Cvoice \u53EF\u9009 alloy/nova/shimmer/onyx/echo\u3002",
      "wait=true\uFF08\u9ED8\u8BA4\uFF09\u7B49\u5F85\u751F\u6210\u5B8C\u6210\u5E76\u8FD4\u56DE\u7ED3\u679C\uFF1B\u6279\u91CF\u4E92\u4E0D\u4F9D\u8D56\u7684\u4EFB\u52A1\u53EF\u8BBE wait=false \u5E76\u884C\u63D0\u4EA4\u3002"
    ].join(""),
    parameters: {
      project_id: { type: "string" },
      kind: { type: "string", required: true, enum: ["image", "video", "audio"] },
      prompt: { type: "string", required: true, description: "\u56FE\u7247/\u89C6\u9891\u753B\u9762\u63CF\u8FF0\uFF0C\u6216\u97F3\u9891\u5F85\u6717\u8BFB\u53F0\u8BCD" },
      node_id: { type: "string" },
      title: { type: "string", description: "\u65B0\u5EFA\u8282\u70B9\u7684\u6807\u9898\uFF0C\u4F8B\u5982\u300C\u955C\u5934 3 \xB7 \u96E8\u591C\u5BF9\u5CD9\u300D\u6216\u300C\u65C1\u767D\xB7\u7B2C1\u96C6\u300D" },
      x: { type: "number" },
      y: { type: "number" },
      reference_node_ids: { type: "array", items: { type: "string" } },
      size: { type: "string", description: "\u56FE\u7247\u5C3A\u5BF8\uFF0C\u5982 1024x1024\u30011536x1024\u30011024x1536" },
      duration: { type: "number", description: "\u89C6\u9891\u79D2\u6570" },
      ratio: { type: "string", enum: ["16:9", "9:16", "1:1"], description: "\u89C6\u9891\u753B\u5E45" },
      voice: { type: "string", description: "\u97F3\u9891 TTS \u97F3\u8272\uFF08\u5982 alloy / nova / shimmer / onyx\uFF09" },
      wait: { type: "boolean" }
    },
    output: { schema: { type: "json" }, render: (_a, v) => json(v) },
    async execute(args, exec) {
      return guard(async () => {
        if (args.prompt.trim() === "") throw new HarnessError("prompt \u4E0D\u80FD\u4E3A\u7A7A", "INVALID_ARGS");
        const projectId = await mujing.resolveProjectId(args.project_id);
        const wait = args.wait !== false;
        const { nodeId, done } = await mujing.startGeneration({
          projectId,
          kind: args.kind,
          prompt: args.prompt,
          nodeId: args.node_id,
          title: args.title,
          x: args.x,
          y: args.y,
          referenceNodeIds: args.reference_node_ids,
          size: args.size,
          duration: args.duration,
          ratio: args.ratio,
          voice: args.voice
        }, wait ? exec.signal : void 0);
        if (!wait) return { project_id: projectId, node_id: nodeId, status: "loading" };
        const node = await done;
        if (node.status === "error") throw new HarnessError(`\u751F\u6210\u5931\u8D25\uFF08\u8282\u70B9 ${nodeId}\uFF09\uFF1A${node.error ?? "\u672A\u77E5\u9519\u8BEF"}`, "MUJING_GENERATION_FAILED");
        return {
          project_id: projectId,
          node_id: nodeId,
          status: node.status ?? "success",
          ...node.url !== void 0 ? { url: node.url } : {},
          ...node.model !== void 0 ? { model: node.model } : {},
          ...node.durationMs !== void 0 ? { durationMs: node.durationMs } : {}
        };
      });
    }
  }));
  ctx.tools.register(defineTool({
    name: "drama_save_plan",
    description: [
      "\u4FDD\u5B58\u6216\u66F4\u65B0\u300C\u5C0F\u8BF4\u2192\u6210\u7247\u77ED\u5267\u6D41\u6C34\u7EBF\u300D\u89C4\u5212\uFF08\u4E16\u754C\u89C2\u98CE\u683C\u3001\u753B\u5E45\u3001\u89D2\u8272\u4E09\u89C6\u56FE\u8BBE\u5B9A\u5361\u3001\u5206\u96C6\u5927\u7EB2\u4E0E\u7ED3\u6784\u5316\u5206\u955C\u8868\uFF09\u3002",
      "\u4FDD\u5B58\u540E\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u5C06\u77ED\u5267\u7684\u955C\u5934\u6309\u5355\u6BB5\u65F6\u957F\uFF08\u9ED8\u8BA4 10s\uFF09\u805A\u5408\u7F16\u8BD1\u6210\u591A\u955C\u5934\u8FDE\u7EED\u89C6\u9891\u63D0\u793A\u8BCD\uFF08\u542B\u540C\u955C\u5C3E\u5E27\u7EED\u62CD / \u6362\u955C / \u6362\u573A\u7B56\u7565\uFF09\uFF0C\u5E76\u540C\u6B65\u6620\u5C04\u4E3A\u753B\u5E03\u4E0A\u7684\u89D2\u8272\u5361\u3001\u5206\u96C6\u5267\u672C\u4E0E\u4E32\u8054\u89C6\u9891\u8282\u70B9\u3002",
      "\u5EFA\u8BAE\u6D41\u7A0B\uFF1A\u6536\u5230\u5C0F\u8BF4\u6216\u957F\u6545\u4E8B\u9700\u6C42\u65F6\uFF0C\u5148\u7528\u6B64\u5DE5\u5177\u5EFA\u597D\u89D2\u8272\u4E0E\u7B2C1~N\u96C6\u5206\u955C\uFF0C\u518D\u7528 drama_generate_casts \u9501\u5B9A\u89D2\u8272\u4E09\u89C6\u56FE\uFF0C\u6700\u540E\u7528 drama_run_episode \u9010\u6BB5\u5C3E\u5E27\u63A5\u9996\u5E27\u751F\u6210\u6210\u7247\u3002"
    ].join(""),
    parameters: {
      project_id: { type: "string" },
      style: { type: "string", description: "\u5168\u5267\u7EDF\u4E00\u7F8E\u672F\u98CE\u683C\uFF0C\u5982\u300C\u7535\u5F71\u7EA7\u51B7\u8C03\u5199\u5B9E\uFF0C\u6D45\u666F\u6DF1\uFF0C35mm\u80F6\u7247\u9897\u7C92\u300D\u6216\u300C\u56FD\u98CE\u4ED9\u4FA03D\u52A8\u753B\u300D" },
      aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"], description: "\u753B\u5E45\u6BD4\u4F8B\uFF08\u7AD6\u5C4F\u77ED\u5267\u63A8\u8350 9:16\uFF0C\u6A2A\u5C4F\u5F71\u89C6\u63A8\u8350 16:9\uFF09" },
      segment_target_sec: { type: "number", description: "\u6BCF\u6BB5\u89C6\u9891\u805A\u5408\u76EE\u6807\u79D2\u6570\uFF083~15\uFF0C\u9ED8\u8BA4 10\uFF09" },
      novel_text: { type: "string", description: "\u7528\u6237\u63D0\u4F9B\u7684\u5C0F\u8BF4\u539F\u6587\u6216\u6545\u4E8B\u6897\u6982" },
      casts: {
        type: "array",
        description: "\u5168\u5267\u6838\u5FC3\u89D2\u8272\u3001\u5E38\u9A7B\u4E3B\u573A\u666F\u6216\u5173\u952E\u9053\u5177\u8BBE\u5B9A",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["character", "scene", "prop"] },
            name: { type: "string", required: true },
            role: { type: "string", description: "\u89D2\u8272\u8EAB\u4EFD\u5B9A\u4F4D\uFF0C\u5982\u300C\u5973\u4E3B\xB7\u51B7\u9762\u6CD5\u533B\u300D" },
            appearance: { type: "string", required: true, description: "\u56FA\u5B9A\u5916\u8C8C\u951A\u70B9\uFF08\u5E74\u9F84\u3001\u53D1\u578B\u53D1\u8272\u3001\u6807\u5FD7\u6027\u670D\u9970\u3001\u6750\u8D28\u914D\u8272\uFF09\uFF0C\u5168\u5267\u4FDD\u6301\u4E0D\u53D8" },
            imagePrompt: { type: "string", description: "\u89D2\u8272\u4E09\u89C6\u56FE\u8BBE\u5B9A\u5361\u6216\u573A\u666F\u7A7A\u955C\u7684\u5B8C\u6574\u82F1\u6587/\u4E2D\u6587\u751F\u56FE\u63D0\u793A\u8BCD" },
            voice: { type: "string", description: "\u89D2\u8272\u63A8\u8350\u914D\u97F3\u97F3\u8272\uFF08\u5982 nova / onyx / alloy\uFF09" }
          }
        }
      },
      episodes: {
        type: "array",
        description: "\u5206\u96C6\u5267\u672C\u4E0E\u955C\u5934\u8868\uFF08\u6BCF\u96C6\u5305\u542B\u5F00\u7BC7\u94A9\u5B50\u3001\u7ED3\u5C3E\u5361\u70B9\u4E0E\u591A\u4E2A\u955C\u5934\uFF09",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            number: { type: "number", required: true, description: "\u96C6\u6570\uFF08\u4ECE 1 \u5F00\u59CB\uFF09" },
            title: { type: "string", required: true },
            synopsis: { type: "string", description: "\u672C\u96C6\u5267\u60C5\u6897\u6982" },
            hook: { type: "string", description: "\u524D 3 \u79D2\u6293\u4EBA\u94A9\u5B50" },
            cliffhanger: { type: "string", description: "\u96C6\u5C3E\u60AC\u5FF5\u5361\u70B9" },
            shots: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  scene: { type: "string", required: true, description: "\u573A\u666F\u5730\u70B9\u4E0E\u65F6\u95F4\u5149\u5F71\uFF0C\u540C\u573A\u666F\u540D\u4F1A\u81EA\u52A8\u89E6\u53D1\u5C3E\u5E27\u5E73\u6ED1\u63A5\u7EED" },
                  shotSize: { type: "string", description: "\u666F\u522B\uFF1A\u8FDC\u666F/\u5168\u666F/\u4E2D\u666F/\u8FD1\u666F/\u7279\u5199" },
                  camera: { type: "string", description: "\u8FD0\u955C\uFF1A\u56FA\u5B9A/\u7F13\u63A8/\u62C9\u8FDC/\u6A2A\u6447/\u8DDF\u62CD/\u73AF\u7ED5" },
                  action: { type: "string", required: true, description: "\u5177\u4F53\u53EF\u89C6\u52A8\u4F5C\u4E0E\u7269\u7406\u7EC6\u8282\u63CF\u8FF0" },
                  speaker: { type: "string", description: "\u8BF4\u8BDD\u89D2\u8272\u540D\uFF08\u65E0\u53F0\u8BCD\u53EF\u7701\u7565\uFF0C\u65C1\u767D\u586B\u300C\u65C1\u767D\u300D\uFF09" },
                  dialogue: { type: "string", description: "\u8BE5\u955C\u5934\u5185\u7684\u7CBE\u70BC\u53F0\u8BCD\uFF08\u5C06\u81EA\u52A8\u751F\u6210\u65F6\u95F4\u8F74\u5B57\u5E55\uFF09" },
                  durationMs: { type: "number", description: "\u5355\u955C\u65F6\u957F\u6BEB\u79D2\u6570\uFF08\u9ED8\u8BA4 3500\uFF0C\u5EFA\u8BAE 2000~5000\uFF09" },
                  transition: { type: "string", enum: ["cut", "fadeblack", "fadewhite"] }
                }
              }
            }
          }
        }
      }
    },
    output: { schema: { type: "json" }, render: (_a, v) => json(v) },
    async execute(args) {
      return guard(async () => {
        const id = await mujing.resolveProjectId(args.project_id);
        const updated = await mujing.saveDrama(id, {
          style: args.style,
          aspectRatio: args.aspect_ratio,
          segmentTargetSec: args.segment_target_sec,
          novelText: args.novel_text,
          casts: args.casts,
          episodes: args.episodes,
          syncCanvasNodes: true
        });
        return {
          project_id: id,
          cast_count: updated.drama?.casts.length ?? 0,
          episodes: (updated.drama?.episodes ?? []).map((ep) => ({
            number: ep.number,
            title: ep.title,
            shot_count: ep.shots.length,
            segment_count: ep.segments.length,
            segments: ep.segments.map((s) => ({
              index: s.index,
              title: s.title,
              handoff: s.handoff,
              durationMs: s.durationMs,
              ...s.videoNodeId !== void 0 ? { videoNodeId: s.videoNodeId } : {}
            }))
          }))
        };
      });
    }
  }));
  ctx.tools.register(defineTool({
    name: "drama_generate_casts",
    description: "\u4E3A\u77ED\u5267\u89D2\u8272/\u5E38\u9A7B\u573A\u666F\u751F\u6210\u4E09\u89C6\u56FE\u8BBE\u5B9A\u56FE\u5E76\u81EA\u52A8\u9501\u5B9A\uFF08locked=true\uFF09\uFF0C\u9501\u5B9A\u540E\u7684\u8BBE\u5B9A\u56FE\u4F1A\u5728\u540E\u7EED\u5404\u6BB5\u89C6\u9891\u751F\u6210\u65F6\u81EA\u52A8\u4F5C\u4E3A\u53C2\u8003\u56FE\u4F20\u5165\u4EE5\u9501\u5B9A\u89D2\u8272\u957F\u76F8\u670D\u88C5\u4E00\u81F4\u3002",
    parameters: {
      project_id: { type: "string" },
      cast_id: { type: "string", description: "\u6307\u5B9A\u5355\u4E2A\u89D2\u8272 id \u6216\u89D2\u8272\u540D\uFF1B\u7F3A\u7701\u5219\u4E3A\u6240\u6709\u5C1A\u672A\u9501\u5B9A\u7684\u89D2\u8272\u5E76\u884C\u751F\u6210\u8BBE\u5B9A\u56FE" }
    },
    output: { schema: { type: "json" }, render: (_a, v) => json(v) },
    async execute(args, exec) {
      return guard(async () => {
        const id = await mujing.resolveProjectId(args.project_id);
        const out = await mujing.generateDramaCastImage(id, args.cast_id, exec.signal);
        return { project_id: id, ...out };
      });
    }
  }));
  ctx.tools.register(defineTool({
    name: "drama_generate_shot_media",
    description: "\u4E3A\u6307\u5B9A\u5267\u96C6\u4E2D\u7684\u5355\u4E2A\u5206\u955C\u6216\u6574\u96C6\u5206\u955C\u6279\u91CF\u751F\u6210\u300C\u6545\u4E8B\u677F\u5173\u952E\u5E27\u56FE\u7247\uFF08kind=keyframe\uFF09\u300D\u6216\u300C\u89D2\u8272\u53F0\u8BCD\u914D\u97F3 TTS\uFF08kind=audio\uFF09\u300D\u3002\u751F\u6210\u7684\u9996\u955C\u5173\u952E\u5E27\u4F1A\u81EA\u52A8\u5728\u89C6\u9891\u751F\u6210\u65F6\u4F5C\u4E3A\u8D77\u5E45\u9996\u5E27\uFF0C\u751F\u6210\u7684\u914D\u97F3\u4F1A\u81EA\u52A8\u6302\u8F7D\u5230\u65F6\u95F4\u7EBF\u97F3\u8F68\u3002",
    parameters: {
      project_id: { type: "string" },
      episode: { type: "number", required: true, description: "\u96C6\u6570\uFF08\u5982 1\uFF09" },
      kind: { type: "string", required: true, enum: ["keyframe", "audio"], description: "keyframe \u751F\u6210\u5206\u955C\u5173\u952E\u5E27\u753B\u9762\uFF0Caudio \u751F\u6210\u5206\u955C\u53F0\u8BCD\u8BED\u97F3" },
      shot_index: { type: "number", description: "\u53EF\u9009\uFF1A\u6307\u5B9A\u5355\u955C\u5E8F\u53F7\uFF080-based\uFF09\uFF1B\u7F3A\u7701\u5219\u4E3A\u8BE5\u96C6\u5168\u90E8\u5206\u955C\u751F\u6210" },
      shot_id: { type: "string", description: "\u53EF\u9009\uFF1A\u6307\u5B9A\u5355\u955C id" }
    },
    output: { schema: { type: "json" }, render: (_a, v) => json(v) },
    async execute(args, exec) {
      return guard(async () => {
        const id = await mujing.resolveProjectId(args.project_id);
        const out = await mujing.generateDramaShotMedia(id, args.episode, {
          kind: args.kind,
          shotIndex: args.shot_index,
          shotId: args.shot_id
        }, exec.signal);
        return { project_id: id, ...out };
      });
    }
  }));
  ctx.tools.register(defineTool({
    name: "drama_run_episode",
    description: [
      "\u6309\u5206\u6BB5\u987A\u5E8F\u6267\u884C\u67D0\u96C6\u77ED\u5267\u89C6\u9891\u751F\u6210\uFF1A",
      "\u5F53\u76F8\u90BB\u5206\u6BB5\u540C\u5C5E\u4E00\u573A\u4E14 handoff=continue \u65F6\uFF0C\u81EA\u52A8\u7528 FFmpeg \u62BD\u53D6\u4E0A\u4E00\u6BB5\u771F\u5B9E\u5C3E\u5E27\u4F5C\u4E3A\u4E0B\u4E00\u6BB5\u7684\u9996\u5E27\uFF08first_frame\uFF09\uFF0C\u5E76\u643A\u5E26\u51FA\u573A\u89D2\u8272\u7684\u9501\u5B9A\u4E09\u89C6\u56FE\uFF0C\u5B9E\u73B0\u957F\u5267\u60C5\u4E1D\u6ED1\u63A5\u7EED\u3002",
      "auto_compose=true \u65F6\uFF0C\u5168\u96C6\u5404\u6BB5\u751F\u6210\u5B8C\u6BD5\u540E\u81EA\u52A8\u63A8\u9001\u65F6\u95F4\u7EBF\u5E76\u8C03\u7528 FFmpeg \u5408\u6210\u5355\u96C6\u5B8C\u6574 MP4 \u6210\u7247\u4E0E SRT \u5B57\u5E55\u3002"
    ].join(""),
    parameters: {
      project_id: { type: "string" },
      episode: { type: "number", required: true, description: "\u96C6\u6570\uFF08\u5982 1\uFF09" },
      segment_index: { type: "number", description: "\u53EF\u9009\uFF1A\u53EA\u91CD\u8DD1\u67D0\u4E00\u6BB5\uFF080-based\uFF09\uFF1B\u7F3A\u7701\u6309\u987A\u5E8F\u8DD1\u5B8C\u6574\u96C6" },
      force_regenerate: { type: "boolean", description: "\u662F\u5426\u5F3A\u5236\u91CD\u8DD1\u5DF2\u6210\u529F\u7684\u5206\u6BB5" },
      auto_compose: { type: "boolean", description: "\u5404\u6BB5\u5168\u90E8\u6210\u529F\u540E\u662F\u5426\u81EA\u52A8\u5408\u6210\u6574\u96C6 MP4 \u6210\u7247\uFF08\u9ED8\u8BA4 true\uFF09" }
    },
    output: { schema: { type: "json" }, render: (_a, v) => json(v) },
    async execute(args, exec) {
      return guard(async () => {
        const id = await mujing.resolveProjectId(args.project_id);
        const runOut = await mujing.runDramaEpisode(id, args.episode, {
          segmentIndex: args.segment_index,
          forceRegenerate: args.force_regenerate
        }, exec.signal);
        let finalVideoUrl;
        const allOk = runOut.segments.length > 0 && runOut.segments.every((s) => s.status === "success");
        if (allOk && args.auto_compose !== false && args.segment_index === void 0) {
          try {
            const composed = await mujing.populateTimelineFromEpisode(id, args.episode, true);
            finalVideoUrl = composed.timeline?.outputUrl;
          } catch {
            await mujing.populateTimelineFromEpisode(id, args.episode, false).catch(() => {
            });
          }
        }
        return { project_id: id, ...runOut, ...finalVideoUrl ? { final_video_url: finalVideoUrl } : {} };
      });
    }
  }));
  ctx.tools.register(defineTool({
    name: "timeline_compose",
    description: "\u7F16\u6392\u9879\u76EE\u65F6\u95F4\u7EBF\u7247\u6BB5\uFF08\u652F\u6301\u6307\u5B9A\u753B\u5E03\u89C6\u9891\u8282\u70B9 nodeId\u3001\u914D\u97F3\u97F3\u9891\u8282\u70B9 audioNodeId \u4E0E\u53F0\u8BCD\u5B57\u5E55 caption\uFF09\uFF0C\u5E76\u8C03\u7528\u672C\u5730 FFmpeg \u5408\u6210\u5B8C\u6574 MP4 \u6210\u7247\u4E0E SRT \u5B57\u5E55\u3002",
    parameters: {
      project_id: { type: "string" },
      clips: {
        type: "array",
        description: "\u53EF\u9009\uFF1A\u66F4\u65B0\u7247\u6BB5\u5217\u8868\uFF1B\u82E5\u5DF2\u7531 drama_run_episode \u63A8\u5165\u65F6\u95F4\u7EBF\u53EF\u7701\u7565\u76F4\u63A5\u5408\u6210",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            nodeId: { type: "string", description: "\u753B\u5E03\u4E0A\u7684\u89C6\u9891\u8282\u70B9 id" },
            title: { type: "string" },
            caption: { type: "string", description: "\u8BE5\u7247\u6BB5\u5BF9\u5E94\u7684\u5B57\u5E55/\u53F0\u8BCD\u6587\u672C" },
            audioNodeId: { type: "string", description: "\u53EF\u9009\uFF1A\u753B\u5E03\u4E0A\u7684\u914D\u97F3\u97F3\u9891\u8282\u70B9 id\uFF0C\u5408\u6210\u65F6\u6DF7\u5165\u8BE5\u7247\u6BB5\u97F3\u8F68" }
          }
        }
      },
      render_mp4: { type: "boolean", description: "\u662F\u5426\u7ACB\u5373\u8C03\u7528 FFmpeg \u62FC\u63A5\u751F\u6210\u5B8C\u6574 MP4\uFF08\u9ED8\u8BA4 true\uFF09" }
    },
    output: { schema: { type: "json" }, render: (_a, v) => json(v) },
    async execute(args) {
      return guard(async () => {
        const id = await mujing.resolveProjectId(args.project_id);
        if (args.clips && args.clips.length > 0) {
          await mujing.saveTimeline(id, { clips: args.clips });
        }
        if (args.render_mp4 !== false) {
          const p2 = await mujing.renderTimeline(id);
          return {
            project_id: id,
            clip_count: p2.timeline?.clips.length ?? 0,
            status: p2.timeline?.status ?? "success",
            output_url: p2.timeline?.outputUrl ?? null,
            has_srt: Boolean(p2.timeline?.subtitleSrt)
          };
        }
        const p = await mujing.store.get(id);
        return {
          project_id: id,
          clip_count: p.timeline?.clips.length ?? 0,
          status: p.timeline?.status ?? "idle",
          output_url: p.timeline?.outputUrl ?? null,
          has_srt: Boolean(p.timeline?.subtitleSrt)
        };
      });
    }
  }));
  ctx.tools.register(defineTool({
    name: "timeline_export_jianying",
    description: "\u5C06\u9879\u76EE\u5F53\u524D\u65F6\u95F4\u7EBF\u5BFC\u51FA\u4E3A\u526A\u6620\u4E13\u4E1A\u7248\uFF08JianyingPro\uFF09\u8349\u7A3F\u76EE\u5F55\uFF0C\u62F7\u8D1D\u5168\u90E8\u89C6\u9891\u7D20\u6750\u5E76\u751F\u6210\u89C6\u9891\u8F68 + \u53F0\u8BCD\u5B57\u5E55\u8F68 + SRT \u6587\u4EF6\uFF0C\u6253\u5F00\u526A\u6620\u5373\u53EF\u7CBE\u526A\u3002",
    parameters: {
      project_id: { type: "string" },
      draft_name: { type: "string", description: "\u8349\u7A3F\u540D\u79F0\uFF0C\u7F3A\u7701\u4F7F\u7528\u300C<\u753B\u5E03\u6807\u9898>-\u5E55\u5883\u8349\u7A3F\u300D" },
      draft_root: { type: "string", description: "\u526A\u6620\u8349\u7A3F\u6839\u76EE\u5F55\uFF0CmacOS \u7F3A\u7701\u81EA\u52A8\u5199\u5165 ~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft" }
    },
    output: { schema: { type: "json" }, render: (_a, v) => json(v) },
    async execute(args) {
      return guard(async () => {
        const id = await mujing.resolveProjectId(args.project_id);
        return await mujing.exportJianyingDraft(id, { draftName: args.draft_name, draftRoot: args.draft_root });
      });
    }
  }));
  ctx.tools.register(defineTool({
    name: "media_status",
    description: "\u67E5\u770B\u56FE\u7247/\u89C6\u9891/\u97F3\u9891\u751F\u6210\u670D\u52A1\u662F\u5426\u5DF2\u914D\u7F6E\u4EE5\u53CA\u6240\u7528\u6A21\u578B\u3002\u751F\u6210\u5931\u8D25\u63D0\u793A\u201C\u672A\u914D\u7F6E\u201D\u65F6\u8C03\u7528\uFF0C\u5E76\u628A\u914D\u7F6E\u65B9\u6CD5\u544A\u8BC9\u7528\u6237\u3002",
    parameters: {},
    output: { schema: { type: "json" }, render: (_a, v) => json(v) },
    async execute() {
      return {
        ...mujing.media.status(),
        hint: "\u5728 mujing \u63D2\u4EF6\u914D\u7F6E\u6216\u73AF\u5883\u53D8\u91CF\u4E2D\u8BBE\u7F6E MUJING_IMAGE_BASE_URL / MUJING_IMAGE_API_KEY\u3001MUJING_VIDEO_BASE_URL / MUJING_VIDEO_API_KEY\u3001MUJING_AUDIO_BASE_URL / MUJING_AUDIO_API_KEY"
      };
    }
  }));
}
export {
  apply,
  inject,
  name
};
//# sourceMappingURL=tools.js.map
