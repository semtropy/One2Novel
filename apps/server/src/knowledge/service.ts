import { skillSchema } from '@one2novel/contracts';
export const skillDefinitions = [
  { id: 'chapter-goal', version: '1', instructions: '围绕本章目标安排可观察的行动和结果。' },
  {
    id: 'character-knowledge',
    version: '1',
    instructions: '角色只能使用已获知的信息，区分当前世界真值和角色观察版本。',
  },
  {
    id: 'ending-hook',
    version: '1',
    instructions: '以本章行动产生的未决问题收束，避免机械悬念和空泛预告。',
  },
];
export const defaultSkills = skillDefinitions.map((d) =>
  skillSchema.parse({
    skillId: d.id,
    definitionVersion: '1',
    enabled: true,
    priority: 50,
    config: { strength: 0.7 },
    applicable: { genres: [], chapterFunctions: [], chapterRange: null },
  }),
);
