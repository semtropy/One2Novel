import type { Response } from "express";
import { getPrisma } from "../../../platform/db/client";
import { generateChapterContentCore } from "./chapterGenerator";
import { processChapter } from "./chapterPipeline";

export async function streamChapter(novelId: string, chapterId: string, res: Response): Promise<void> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter) throw new Error("Chapter not found");

  // C4: Client disconnect cleanup — abort LLM stream when client disconnects
  let aborted = false;
  const abortController = new AbortController();
  res.on("close", () => {
    aborted = true;
    abortController.abort();
  });

  res.writeHead(200, {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
    Connection: "keep-alive", "X-Accel-Buffering": "no",
  });
  const send = (event: string, data: unknown) => {
    if (aborted) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send("stage", { stage: "writing" });

    const fullContent = await generateChapterContentCore(novelId, chapterId, {
      signal: abortController.signal,
      onToken: (text) => send("token", { text }),
    });

    if (aborted) return; // Client disconnected — don't save partial content

    // Run full pipeline: quality gate → repair → persist → post-write hooks → finalization
    send("stage", { stage: "quality_gate" });
    const pipelineResult = await processChapter(novelId, chapterId, fullContent, chapter.order);
    if (pipelineResult.repairAttempts > 0) {
      send("stage", { stage: "repair", attempts: pipelineResult.repairAttempts });
    }

    if (aborted) return;

    send("complete", {
      status: pipelineResult.status,
      wordCount: pipelineResult.content.length,
      qualityScore: pipelineResult.score,
      repairAttempts: pipelineResult.repairAttempts,
      message: pipelineResult.status === "completed"
        ? "章节已生成并通过质量检查。点击「审查」查看详细评分。"
        : "质量未达标（已尝试自动修复），建议点击「审查」查看详情或手动「AI 修复」。",
    });
  } catch (e) {
    send("error", { message: e instanceof Error ? e.message : "生成失败" });
  } finally {
    res.end();
  }
}

