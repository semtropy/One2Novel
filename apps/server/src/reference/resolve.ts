import { z } from 'zod';
import type { DB } from '../platform/db.js';
import { id, type ReferenceResult, type ReferenceEntityData } from '@one2novel/contracts';
import { asJson, hash, requireThat, uuid } from '../platform/core.js';
import { validateReferenceResult } from './analysis.js';

export const resolutionSchema = z.strictObject({
  analysisVersionId: id,
  expectedRevision: z.number().int().nonnegative(),
  decisions: z
    .array(
      z.strictObject({
        candidateId: id,
        action: z.enum(['KEEP_SEPARATE', 'MERGE']),
        targetEntityId: id.nullable(),
      }),
    )
    .min(1),
});
export async function resolveIdentities(db: DB, sourceId: string, body: unknown) {
  const b = resolutionSchema.parse(body);
  return db.$transaction(
    async (tx) => {
      const s = await tx.referenceSource.findUniqueOrThrow({ where: { id: sourceId } }),
        a = await tx.referenceAnalysis.findUniqueOrThrow({
          where: { id: b.analysisVersionId },
          include: { units: { orderBy: { number: 'asc' } } },
        });
      requireThat(
        s.revision === b.expectedRevision &&
          a.sourceId === sourceId &&
          a.splitId === s.activeSplitId &&
          !(await tx.libraryCommand.findUnique({ where: { scope: `reference:${sourceId}` } })),
        'REVISION_CONFLICT',
        '参考版本已变化或正在分析',
        409,
      );
      requireThat(
        a.units.every((u) => u.payload && hash(u.payload) === u.hash) &&
          a.completedChars === a.totalChars,
        'REFERENCE_INCOMPLETE',
        '先完成所有分析单元，再统一确认实体',
      );
      const unresolved = a.units.flatMap(
          (u) => (u.payload as ReferenceResult).unresolvedIdentities,
        ),
        unique = new Map(unresolved.map((u) => [u.candidateId, u]));
      requireThat(
        b.decisions.length === unique.size &&
          new Set(b.decisions.map((d) => d.candidateId)).size === unique.size,
        'INVALID_RESOLUTION',
        '请确认全部待整理身份',
      );
      const redirects = new Map<string, string>();
      for (const d of b.decisions) {
        const conflict = unique.get(d.candidateId);
        requireThat(conflict, 'INVALID_RESOLUTION', '未知候选');
        if (d.action === 'MERGE') {
          requireThat(
            d.targetEntityId &&
              conflict.possibleEntityIds.includes(d.targetEntityId) &&
              d.targetEntityId !== d.candidateId,
            'INVALID_RESOLUTION',
            '只能合并到已出现的同类候选',
          );
          redirects.set(d.candidateId, d.targetEntityId);
        } else
          requireThat(d.targetEntityId === null, 'INVALID_RESOLUTION', '保留独立身份不需要目标');
      }
      const root = (v: string) => {
        const seen = new Set<string>();
        while (redirects.has(v)) {
          requireThat(!seen.has(v), 'INVALID_RESOLUTION', '合并不能形成循环');
          seen.add(v);
          v = redirects.get(v)!;
        }
        return v;
      };
      const rewrite = (v: any): any =>
        typeof v === 'string'
          ? root(v)
          : Array.isArray(v)
            ? v.map(rewrite)
            : v && typeof v === 'object'
              ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x)]))
              : v;
      const oldJob = await tx.job.findUniqueOrThrow({ where: { id: a.jobId } });
      const job = await tx.job.create({
        data: {
          id: uuid(),
          projectId: null,
          kind: 'REFERENCE_RESOLUTION',
          status: 'SUCCEEDED',
          stage: 'SUCCEEDED',
          chainEpoch: 0,
          input: asJson({
            sourceId,
            parentAnalysisId: a.id,
            decisions: b.decisions,
            confirmedAffectedUnitIds: a.units.map((u) => u.id),
          }),
          config: asJson(oldJob.config),
          artifactRefs: {},
          httpLimit: 0,
        },
      });
      const version = await tx.referenceAnalysis.create({
        data: {
          id: uuid(),
          sourceId,
          splitId: a.splitId,
          jobId: job.id,
          status: 'COMPLETE',
          totalChars: a.totalChars,
          completedChars: a.totalChars,
          registryHead: a.registryHead,
          summary: a.summary || '实体身份已确认，完整剧情摘要保留在逐单元记录中。',
        },
      });
      const candidates = new Map<string, ReferenceEntityData>();
      for (const u of a.units) {
        let result = rewrite(u.payload) as ReferenceResult;
        result.unresolvedIdentities = [];
        const merged = new Map<string, ReferenceEntityData>();
        for (const e of result.entities) {
          const old = candidates.get(e.id) || merged.get(e.id);
          if (old) {
            requireThat(old.kind === e.kind, 'INVALID_RESOLUTION', '不同类型不能合并');
            e.aliases = [
              ...new Set([...old.aliases, ...e.aliases, ...(old.name !== e.name ? [e.name] : [])]),
            ];
            e.name = old.name;
          }
          merged.set(e.id, e);
        }
        result.entities = [...merged.values()];
        result = validateReferenceResult(
          result,
          s.text,
          s.textId,
          u.inputStart,
          u.end,
          [...candidates.values()],
          false,
          u.start,
        );
        // The user explicitly confirms the identity interpretation for the derived version.
        result.unresolvedIdentities = [];
        await tx.referenceUnit.create({
          data: {
            id: uuid(),
            analysisId: version.id,
            number: u.number,
            chapterNo: u.chapterNo,
            start: u.start,
            end: u.end,
            inputStart: u.inputStart,
            inputHash: u.inputHash,
            registryVersion: u.registryVersion,
            retrieval: asJson({
              manualSourceUnitId: u.id,
              parentAnalysisId: a.id,
              decisions: b.decisions,
            }),
            payload: asJson(result),
            hash: hash(result),
          },
        });
        for (const e of result.entities) {
          candidates.set(e.id, e);
          await tx.referenceEntity.create({
            data: {
              rowId: uuid(),
              entityId: e.id,
              analysisId: version.id,
              throughUnit: u.number,
              chapterNo: u.chapterNo,
              payload: asJson(e),
            },
          });
        }
      }
      await tx.referenceSource.update({
        where: { id: sourceId },
        data: { revision: { increment: 1 } },
      });
      return version;
    },
    { timeout: 30000 },
  );
}
