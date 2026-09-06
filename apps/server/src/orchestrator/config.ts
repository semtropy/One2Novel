import { settingsSchema, skillSchema, type Settings } from '@one2novel/contracts';
import type { DB } from '../platform/db.js';
import { promptVersion } from '../platform/prompts.js';
import { asJson, requireThat, uuid } from '../platform/core.js';
import { defaultPolicy, validatePolicy, evaluators } from '../evaluation/service.js';
import { defaultSkills, skillDefinitions } from '../knowledge/service.js';
export const defaultSettings: Settings = {
  baseUrl: 'https://api.chatanywhere.tech/v1',
  profiles: [],
  roleMappings: { planner: '', writer: '', reviewer: '', extractor: '', repairer: '' },
};
export async function seedConfig(db: DB) {
  for (const [kind, payload] of Object.entries({
    models: defaultSettings,
    policy: defaultPolicy,
    skills: defaultSkills,
  })) {
    await db.$transaction(async (tx) => {
      if (await tx.configPointer.findUnique({ where: { kind } })) return;
      const v = await tx.configVersion.create({
        data: { id: uuid(), kind, payload: asJson(payload) },
      });
      await tx.configPointer.create({ data: { kind, versionId: v.id } });
    });
  }
}
export async function getConfig(db: DB, kind: string) {
  const p = await db.configPointer.findUniqueOrThrow({ where: { kind } }),
    v = await db.configVersion.findUniqueOrThrow({ where: { id: p.versionId } });
  return { versionId: v.id, revision: p.revision, payload: v.payload };
}
export async function saveConfig(db: DB, kind: string, raw: unknown, revision: number) {
  let payload: unknown;
  if (kind === 'models') {
    payload = settingsSchema.parse(raw);
    const s = payload as Settings;
    requireThat(
      new Set(s.profiles.map((p) => p.id)).size === s.profiles.length &&
        Object.values(s.roleMappings).every((id) => s.profiles.some((p) => p.id === id)),
      'INVALID_CONFIG',
      '模型身份重复或角色未映射',
    );
  } else if (kind === 'policy') payload = validatePolicy(raw);
  else {
    payload = skillSchema.array().parse(raw);
    const list = payload as typeof defaultSkills;
    requireThat(
      new Set(list.map((s) => s.skillId)).size === list.length &&
        list.every((s) => skillDefinitions.some((d) => d.id === s.skillId)),
      'INVALID_CONFIG',
      'Skill未注册或重复',
    );
  }
  return db.$transaction(async (tx) => {
    const p = await tx.configPointer.findUniqueOrThrow({ where: { kind } });
    requireThat(p.revision === revision, 'REVISION_CONFLICT', '配置已被其他页面修改', 409);
    const v = await tx.configVersion.create({
      data: { id: uuid(), kind, payload: asJson(payload) },
    });
    await tx.configPointer.update({
      where: { kind },
      data: { versionId: v.id, revision: { increment: 1 } },
    });
    return { versionId: v.id, revision: revision + 1, payload };
  });
}
export async function freezeConfig(db: DB) {
  const [models, policy, skills] = await Promise.all([
    getConfig(db, 'models'),
    getConfig(db, 'policy'),
    getConfig(db, 'skills'),
  ]);
  return {
    models,
    policy,
    skills,
    promptVersion,
    stateRuleVersion: '1',
    evaluatorVersions: Object.fromEntries(evaluators.map((e) => [e.id, e.version])),
  };
}
export type FrozenConfig = Awaited<ReturnType<typeof freezeConfig>>;
