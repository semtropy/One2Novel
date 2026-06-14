import { getPrisma } from "../../../platform/db/client";
import { createLLM } from "../../../platform/llm/provider";
import { getPreferredProvider, compileAsset } from "../../../platform/llm/aiService";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { assembleChapterBlocks } from "./contextAssembler";
import { resolveAntiAiPrompt } from "../../style/styleRuntimeResolver";
import { injectSkillRules, getSkillModulesForPosition } from "../../../platform/llm/skillRules";
import { detectChapterPosition } from "../../../platform/llm/promptBudgetProfiles";

export interface ChapterGenerateOptions {
  /** AbortSignal for client-disconnect scenarios (SSE) */
  signal?: AbortSignal;
  /** Callback for each token chunk — emitted via SSE or Director emitter */
  onToken?: (text: string) => void;
}

/**
 * Shared LLM pipeline for chapter content generation.
 * Used by both the SSE manual-write path (chapterWriter.ts) and
 * the batch auto-write path (directorService.ts).
 *
 * Pipeline:
 *   assembleChapterBlocks → compileAsset → injectSkill + antiAi → llm.stream
 */
export async function generateChapterContentCore(
  novelId: string,
  chapterId: string,
  opts?: ChapterGenerateOptions,
): Promise<string> {
  const blocks = await assembleChapterBlocks(novelId, chapterId);
  const { systemPrompt: baseSystem, userPrompt } = compileAsset({
    assetId: "novel.chapter.writer",
    blocks,
  });

  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { chapters: { select: { id: true } } },
  });

  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { order: true },
  });
  if (!chapter) throw new Error("Chapter not found");

  const position = detectChapterPosition(chapter.order, novel?.chapters.length ?? 1);
  const skillModules = getSkillModulesForPosition(position);
  const antiAiPrompt = await resolveAntiAiPrompt(novelId, chapterId);
  const systemPrompt = injectSkillRules(baseSystem, skillModules)
    + (antiAiPrompt ? "\n\n" + antiAiPrompt : "");

  const llm = createLLM(getPreferredProvider(), { temperature: 0.85, maxTokens: 8192 });
  const stream = await llm.stream(
    [new SystemMessage(systemPrompt), new HumanMessage(userPrompt)],
    opts?.signal ? { signal: opts.signal } : undefined,
  );

  let fullContent = "";
  for await (const chunk of stream) {
    const text = typeof chunk.content === "string"
      ? chunk.content
      : Array.isArray(chunk.content)
        ? chunk.content.map(c => typeof c === "string" ? c : "").join("")
        : "";
    if (text) {
      fullContent += text;
      opts?.onToken?.(text);
    }
  }

  return fullContent;
}
