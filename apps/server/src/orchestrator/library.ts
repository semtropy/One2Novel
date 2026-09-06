import type { Job } from '@prisma/client';
import { z } from 'zod';
import {
  referenceResultSchema,
  aggregateSchema,
  assetPackSchema,
  type ReferenceResult,
} from '@one2novel/contracts';
import type { DB } from '../platform/db.js';
import type { PromptId } from '../platform/prompts.js';
import { asJson, hash, identifiers, remapProposal, requireThat, uuid } from '../platform/core.js';
import { retrieveEntities, validateReferenceResult } from '../reference/analysis.js';
import {
  appendKnowledge,
  cleanAssets,
  deriveKnowledge,
  validateKnowledgeSources,
} from '../knowledge/library.js';

export type LibraryCall = <T>(
  job: Job,
  prompt: PromptId,
  input: unknown,
  schema: z.ZodType<T>,
) => Promise<T>;
async function stage(db: DB, jobId: string, name: string) {
  await db.$transaction(async (tx) => {
    const job = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    requireThat(!job.cancelRequested, 'CANCELLED', '任务已取消');
    await tx.job.update({
      where: { id: jobId },
      data: { stage: name, revision: { increment: 1 } },
    });
    await tx.jobEvent.create({ data: { jobId, type: 'stage', payload: { stage: name } } });
  });
}
export async function runLibrary(db: DB, j: Job, call: LibraryCall) {
  if (j.kind === 'REFERENCE_ANALYSIS') {
    const analysis = await db.referenceAnalysis.findUniqueOrThrow({
      where: { jobId: j.id },
      include: { source: true, units: { orderBy: { number: 'asc' } } },
    });
    const chars = [...analysis.source.text];
    for (const unit of analysis.units) {
      if (unit.payload) {
        requireThat(hash(unit.payload) === unit.hash, 'ARTIFACT_CORRUPTED', '已完成分析单元损坏');
        continue;
      }
      await stage(db, j.id, `ANALYZE_UNIT`);
      const inputText = chars.slice(unit.inputStart, unit.end).join('');
      requireThat(
        unit.inputHash ===
          hash([inputText, unit.start, unit.end, analysis.splitId, hash(j.config)]),
        'STALE_INPUT',
        '分析单元输入版本不一致',
      );
      const retrieval =
        (unit.retrieval as Awaited<ReturnType<typeof retrieveEntities>> | null) ||
        (await retrieveEntities(db, analysis.id, unit.registryVersion, unit.chapterNo, inputText));
      if (!unit.retrieval)
        await db.referenceUnit.update({
          where: { id: unit.id },
          data: { retrieval: asJson(retrieval) },
        });
      const proposal = await call(
        j,
        'reference.chapter',
        {
          textVersionId: analysis.source.textId,
          text: inputText,
          inputStart: unit.inputStart,
          primaryStart: unit.start,
          primaryEnd: unit.end,
          chapterNo: unit.chapterNo,
          unitId: unit.id,
          candidates: retrieval.candidates,
          registryVersion: retrieval.registryVersion,
        },
        referenceResultSchema,
      );
      const result = validateReferenceResult(
        proposal,
        analysis.source.text,
        analysis.source.textId,
        unit.inputStart,
        unit.end,
        retrieval.candidates,
        true,
        unit.start,
      );
      await db.$transaction(async (tx) => {
        const latest = await tx.job.findUniqueOrThrow({ where: { id: j.id } });
        requireThat(!latest.cancelRequested, 'CANCELLED', '任务已取消');
        const current = await tx.referenceAnalysis.findUniqueOrThrow({
          where: { id: analysis.id },
        });
        requireThat(
          current.registryHead === unit.registryVersion,
          'STALE_INPUT',
          '实体索引版本已变化',
        );
        await tx.referenceUnit.update({
          where: { id: unit.id },
          data: { payload: asJson(result), hash: hash(result) },
        });
        for (const entity of result.entities)
          await tx.referenceEntity.create({
            data: {
              rowId: uuid(),
              entityId: entity.id,
              analysisId: analysis.id,
              throughUnit: unit.number,
              chapterNo: unit.chapterNo,
              payload: asJson(entity),
            },
          });
        await tx.referenceAnalysis.update({
          where: { id: analysis.id },
          data: {
            status: 'PARTIAL',
            registryHead: unit.number,
            completedChars: { increment: unit.end - unit.start },
          },
        });
        await tx.jobEvent.create({
          data: {
            jobId: j.id,
            type: 'progress',
            payload: {
              unitId: unit.id,
              completedUnits: unit.number,
              totalUnits: analysis.units.length,
            },
          },
        });
      });
    }
    const units = await db.referenceUnit.findMany({
      where: { analysisId: analysis.id },
      orderBy: { number: 'asc' },
    });
    requireThat(
      units.every((u) => u.payload && !(u.payload as ReferenceResult).unresolvedIdentities.length),
      'ENTITY_UNRESOLVED',
      '存在待确认的同名实体，请整理身份后发布',
    );
    await stage(db, j.id, 'AGGREGATE');
    let nodes = units.map((u) => ({
      unitIds: [u.id],
      summary: (u.payload as ReferenceResult).summary,
    }));
    // Every merge retains all descendant unit IDs. Oversized groups shrink, never drop units.
    while (nodes.length > 1) {
      const next: typeof nodes = [];
      for (let i = 0; i < nodes.length; ) {
        let size = Math.min(8, nodes.length - i);
        if (size === 1) {
          next.push(nodes[i]);
          i++;
          continue;
        }
        for (;;) {
          const group = nodes.slice(i, i + size),
            key = hash([group, j.config]);
          const cached = await db.referenceAggregate.findUnique({
            where: { analysisId_inputHash: { analysisId: analysis.id, inputHash: key } },
          });
          let output: z.infer<typeof aggregateSchema>;
          try {
            output = cached
              ? aggregateSchema.parse(cached.payload)
              : await call(j, 'reference.aggregate', { children: group }, aggregateSchema);
          } catch (e: any) {
            if (e.code === 'CONTEXT_TOO_LARGE' && size > 2) {
              size = Math.max(2, Math.floor(size / 2));
              continue;
            }
            throw e;
          }
          const expected = group.flatMap((g) => g.unitIds).sort();
          requireThat(
            hash([...output.unitIds].sort()) === hash(expected),
            'INVALID_REFERENCE',
            '聚合遗漏或新增了原文单元',
          );
          if (!cached)
            await db.referenceAggregate.create({
              data: {
                id: uuid(),
                analysisId: analysis.id,
                inputHash: key,
                payload: asJson(output),
              },
            });
          next.push(output);
          i += size;
          break;
        }
      }
      nodes = next;
    }
    await db.$transaction(async (tx) => {
      const latest = await tx.job.findUniqueOrThrow({ where: { id: j.id } });
      const current = await tx.referenceAnalysis.findUniqueOrThrow({ where: { id: analysis.id } });
      requireThat(
        !latest.cancelRequested && current.completedChars === current.totalChars,
        'REFERENCE_INCOMPLETE',
        '分析覆盖不完整或已取消',
      );
      await tx.referenceAnalysis.update({
        where: { id: analysis.id },
        data: { status: 'COMPLETE', summary: nodes[0].summary },
      });
      await tx.job.update({
        where: { id: j.id },
        data: { status: 'SUCCEEDED', stage: 'SUCCEEDED', revision: { increment: 1 } },
      });
      await tx.libraryCommand.deleteMany({ where: { jobId: j.id } });
      await tx.jobEvent.create({
        data: { jobId: j.id, type: 'done', payload: { analysisId: analysis.id } },
      });
    });
  } else {
    const input = j.input as {
      itemId: string;
      sourceVersionId: string;
      operation: 'FRAMEWORK' | 'RAW' | 'CLEAN' | 'ADAPT';
      brief: string;
      revision: number;
    };
    await stage(db, j.id, 'BUILD_KNOWLEDGE');
    let payload: any;
    if (input.operation === 'RAW' || input.operation === 'FRAMEWORK')
      payload = await deriveKnowledge(
        db,
        input.sourceVersionId,
        input.operation === 'RAW' ? 'ASSET_PACK' : 'FRAMEWORK',
      );
    else {
      const source = await db.knowledgeVersion.findUniqueOrThrow({
        where: { id: input.sourceVersionId },
      });
      requireThat(
        source.publishedAt && hash(source.payload) === source.hash,
        'INVALID_REFERENCE',
        '前置知识版本未发布或损坏',
      );
      if (input.operation === 'CLEAN')
        payload = { ...cleanAssets(source.payload), sourceVersionId: source.id };
      else {
        const old = assetPackSchema.parse(source.payload);
        requireThat(old.stage === 'CLEAN', 'INVALID_KNOWLEDGE', '请先发布清洗后的素材');
        payload = await call(
          j,
          'knowledge.adapt',
          { source: old, sourceVersionId: source.id, adaptationBrief: input.brief },
          assetPackSchema,
        );
        payload = remapProposal(payload, identifiers({ source: old, sourceVersionId: source.id }));
        requireThat(
          payload.stage === 'ADAPTED' &&
            payload.adaptationBrief === input.brief &&
            payload.assets.length === old.assets.length &&
            new Set(payload.mapping.map((m: any) => m.oldId)).size === old.assets.length,
          'INVALID_KNOWLEDGE',
          '改编必须覆盖每份已选择素材',
        );
      }
    }
    const kind = input.operation === 'FRAMEWORK' ? 'FRAMEWORK' : 'ASSET_PACK';
    await validateKnowledgeSources(db, kind, payload, input.sourceVersionId);
    await db.$transaction(async (tx) => {
      const latest = await tx.job.findUniqueOrThrow({ where: { id: j.id } });
      requireThat(!latest.cancelRequested, 'CANCELLED', '任务已取消');
      const v = await appendKnowledge(
        tx,
        input.itemId,
        payload,
        input.revision,
        input.sourceVersionId,
      );
      await tx.job.update({
        where: { id: j.id },
        data: {
          status: 'SUCCEEDED',
          stage: 'SUCCEEDED',
          artifactRefs: { KNOWLEDGE_VERSION: v.id },
          revision: { increment: 1 },
        },
      });
      await tx.libraryCommand.deleteMany({ where: { jobId: j.id } });
      await tx.jobEvent.create({
        data: { jobId: j.id, type: 'done', payload: { versionId: v.id } },
      });
    });
  }
}
