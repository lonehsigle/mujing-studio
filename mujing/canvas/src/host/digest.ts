/** 给模型看的紧凑画布 + 短剧 + 时间线视图。 */

import type { CanvasProject } from './types.ts'

export function digestProject(project: CanvasProject): Record<string, unknown> {
  return {
    project_id: project.id,
    title: project.title,
    rev: project.rev,
    nodes: project.nodes.map(n => ({
      id: n.id, type: n.type, title: n.title, x: Math.round(n.x), y: Math.round(n.y), w: n.width, h: n.height,
      ...(n.content !== undefined ? { content: n.content } : {}),
      ...(n.prompt !== undefined ? { prompt: n.prompt } : {}),
      ...(n.voice !== undefined ? { voice: n.voice } : {}),
      ...(n.url ? { url: n.url } : {}),
      status: n.status ?? 'idle',
      ...(n.error ? { error: n.error } : {}),
      ...(n.model ? { model: n.model } : {}),
      ...(n.durationMs ? { durationMs: n.durationMs } : {}),
    })),
    edges: project.edges.map(e => [e.source, e.target]),
    ...(project.drama
      ? {
        drama: {
          ...(project.drama.genre ? { genre: project.drama.genre } : {}),
          ...(project.drama.logline ? { logline: project.drama.logline } : {}),
          style: project.drama.style,
          aspectRatio: project.drama.aspectRatio,
          language: project.drama.language,
          segmentTargetSec: project.drama.segmentTargetSec,
          hasNovel: Boolean(project.drama.novelText),
          casts: project.drama.casts.map(c => ({
            id: c.id, kind: c.kind, name: c.name, role: c.role, appearance: c.appearance,
            voice: c.voice, imageNodeId: c.imageNodeId, imageUrl: c.imageUrl, locked: Boolean(c.locked),
          })),
          episodes: project.drama.episodes.map(ep => ({
            id: ep.id, number: ep.number, title: ep.title, synopsis: ep.synopsis,
            shotCount: ep.shots.length,
            shots: ep.shots.map((sh, idx) => ({
              id: sh.id,
              number: idx + 1,
              segmentIndex: sh.segmentIndex,
              scene: sh.scene,
              shotSize: sh.shotSize,
              camera: sh.camera,
              action: sh.action,
              ...(sh.speaker ? { speaker: sh.speaker } : {}),
              ...(sh.dialogue ? { dialogue: sh.dialogue } : {}),
              ...(sh.keyframeUrl ? { keyframeUrl: sh.keyframeUrl } : {}),
              ...(sh.audioUrl ? { audioUrl: sh.audioUrl } : {}),
            })),
            segments: ep.segments.map(s => ({
              index: s.index, title: s.title, handoff: s.handoff, durationMs: s.durationMs,
              status: s.status, videoNodeId: s.videoNodeId, firstFrameUrl: s.firstFrameUrl,
            })),
            finalVideoUrl: ep.finalVideoUrl,
          })),
        },
      }
      : {}),
    ...(project.timeline
      ? {
        timeline: {
          clipCount: project.timeline.clips.length,
          clips: project.timeline.clips.map(c => ({ id: c.id, nodeId: c.nodeId, title: c.title, url: c.url, durationMs: c.durationMs, caption: c.caption })),
          status: project.timeline.status ?? 'idle',
          outputUrl: project.timeline.outputUrl,
        },
      }
      : {}),
  }
}
