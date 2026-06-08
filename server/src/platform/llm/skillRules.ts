// Compiled from chinese-novelist Skill writing guides
// Each rule set is a ready-to-inject prompt block

export const SKILL_OPENINGS = `
## 开头技巧（十种强力开头，禁止六种致命错误）
死亡开头：天气描写、日常流程、回顾上章、缓慢铺垫、平淡对话、过度解释
推荐开头：行动中开场(In Media Res)、反常情境、震撼对话、倒计时开场、重大发现、危机时刻、谜团浮现、背叛开场、重大选择、结局预告

前20%必须达到：即时紧张感、重大事件发生、情感冲击、继续阅读的欲望
`.trim();

export const SKILL_HOOKS = `
## 章尾悬念（悬念钩子十三式 + 章首引子七式）
章尾钩子类型：突然揭示、紧急危机、未完成的动作、身份反转、两难选择、神秘物品/线索、时间限制、人物失踪、意外来访、旧伤复发、暗流初现、代价浮现、规则改写
章首引子类型：悬念式、反常式、情感式、行动式、对话式、场景式、意象式

悬念强度五等级：轻微好奇 → 中等好奇 → 强烈好奇 → 轻微焦虑 → 强烈焦虑
每章结尾根据剧情阶段匹配适当强度
`.trim();

export const SKILL_DIALOGUE = `
## 对话规范（四项核心原则 + 潜台词技法）
每句对话必须至少完成以下之一：推动情节、揭示人物、制造冲突、传达信息、表达情感、制造悬念
禁止无信息量寒暄对话（你好/吃了吗/天气真好）
避免过度使用副词修饰对话标签（"他愤怒地说"→"他的声音在颤抖"）

潜台词技巧：话题转移、反问代替回答、表面恭维暗藏讽刺、关心话语隐含控制
`.trim();

export const SKILL_CHARACTER = `
## 角色塑造（矛盾创造深度 + 侧面揭示 + 缺陷致命化）
矛盾创造深度：冷血杀手每天喂流浪猫、雷厉风行的女警回家对亡夫照片说话
侧面揭示：用行动表现性格（他捏碎手中纸杯 > 他很愤怒）、用选择揭示本质（火灾救猫而非名画）、用习惯暴露真相（总坐背靠墙位置→缺乏安全感）

缺陷致命化：傲慢→低估对手落入陷阱、完美主义→错失行动时机、复仇心→被利用失去理智
每个角色必须有缺陷，缺陷必须在关键时刻导致失败
`.trim();

export const SKILL_PACING = `
## 节奏控制（长短句交替 + 段落呼吸 + 信息密度波浪）
长短句规则：连续三句长度相同必须打破、动作场景句子<10字、转折时刻用极短句
段落呼吸：紧张场景一段一两句话、缓和场景一段五六句话、转折爆发长段中插入单句段
信息密度波浪：高(动作/对话/揭示) → 低(沉淀/描写/内心) → 高(新冲突/转折) → 低(消化/过渡)
每章至少2个张力波峰，连续500字以上无冲突必须引入新张力
`.trim();

export const SKILL_BAN = `
## AI痕迹清除（重点禁止 + 词汇黑名单）
禁止词汇：璀璨、瑰丽、心潮澎湃、热血沸腾、油然而生、不禁
禁止句式：此外/然而/值得注意的是/需要强调的是
禁止表达：大段内心独白代替行动、直接陈述情感（很愤怒→握紧拳头）、无信息量寒暄对话
禁止结构：重复回顾空泛心理独白凑字数、重写开头/换说法再说一遍、总结性语句代替剧情发展
`.trim();

// ─── Phase 12 Skill Gap Fill: 6 missing principles ────

export const SKILL_SUSPENSE_LEVELS = `
## 悬念强度五等级
每章结尾的悬念强度应根据剧情阶段匹配：
1. 轻微好奇 — 过渡章：读者想知道「接下来怎样」，不强制一口气读完
2. 中等好奇 — 铺垫章：抛出一个具体问题，读者想尽快知道答案
3. 强烈好奇 — 推进章：揭示部分信息但同时抛出更大谜团
4. 轻微焦虑 — 转折章：角色陷入困境，读者担心其命运
5. 强烈焦虑 — 高潮章：角色面临生死/重大抉择，读者必须立即看下一章

强度选择规则：连续两章不得使用同一等级。高潮章用4-5级，过渡章用1-2级。
`.trim();

export const SKILL_SUSPENSE_STRATEGY = `
## 悬念编排策略
**单章三段式：** 开头抛出新问题→中段制造信息差→结尾揭示部分答案同时升级悬念
**跨章三弧线：** 每3-5章构成一个悬念弧——埋设→施压→部分兑现→新悬念
**悬念清单原则：** 每章至少回应一个旧悬念（哪怕是部分回应），每章至少提出一个新悬念或升级现有悬念
`.trim();

export const SKILL_SCENE_TEXTURE = `
## 场景肌理充实（感官/空间/情绪三维度）
**感官层：** 视觉+听觉+触觉+嗅觉，每场景至少覆盖两种感官。不写「屋里很暗」，写「他伸手不见五指，地板在脚下嘎吱作响，空气中有股霉味」。
**空间层：** 角色在空间中的位置、移动、与物体的距离。读者应能画出场景的俯视图。
**情绪层：** 环境映射或反衬角色心理。焦虑时注意钟声/水滴声；平静时注意光线/温度。
`.trim();

export const SKILL_BULLET_TIME = `
## 关键时刻放慢（子弹时间）
当剧情到达关键转折、重大揭示、生死抉择时，将时间感知放慢：
- 把一秒拆成三秒写：动作→感官→心理反应→后果预判→执行
- 关键动作分解：准备→执行→接触→后果→反应（5步法）
- 使用极短句和单句段落制造紧张节奏
- 放慢后必须接一个快速过渡恢复正常节奏（急停→急起）
`.trim();

export const SKILL_FATAL_FLAW = `
## 缺陷致命化
每个角色必须有缺陷，缺陷必须在关键时刻导致失败：
- 傲慢→低估对手落入陷阱
- 完美主义→错失行动时机
- 复仇心→被利用失去理智
- 过度信任→被最亲近的人背叛
- 逃避过去→过去追上来吞噬现在
角色的缺陷不是标签，是情节引擎。大纲阶段就应明确：每个核心角色的缺陷将在哪一章、以何种方式导致关键失败。
`.trim();

export const SKILL_PLOT_STRUCTURES = `
## 故事结构模板
**三幕式：** 建立（25%）→对抗（50%）→解决（25%）。第一幕结束于「不可回头点」，第二幕结束于「最黑暗时刻」。
**英雄之旅（12步）：** 平凡世界→冒险召唤→拒绝召唤→遇见导师→跨越门槛→考验/盟友/敌人→接近核心→考验→获得奖赏→返回之路→复活→携宝归返。
**悬疑结构：** 罪行→调查→初步结论（错）→新线索→推翻→真相浮现→最终对峙。
选择一种结构后，将关键节点映射到具体章节，确保每卷至少完成结构中的一个阶段。
`.trim();

export const SKILL_LITERARY = `
## 中文文学技法（白描 + 留白 + 意象 + 草蛇灰线 + 蒙太奇）
白描：名词和动词为主，形容词能砍就砍。一句话最多一个修饰语。动作代替形容（他扶着墙站起来 > 他老了）
留白：对话在沉默处收笔、情感写动作不写感受、转折写到发生瞬间停止
意象：用一个反复出现的具象物品承载抽象情感（一本书不超过3个意象）
草蛇灰线：埋伏笔时伪装成无关紧要的闲笔，揭晓时不大张旗鼓，间隔至少5章
蒙太奇：两个场景直接切换不用过渡语，对比产生第三层含义
`.trim();

// ─── 2.2: Dynamic module selection by chapter position ──

export type ChapterPosition = "first" | "early" | "climax" | "transition" | "normal";

/** Select Skill modules based on chapter position to optimize token budget */
export function getSkillModulesForPosition(position: ChapterPosition): string[] {
  switch (position) {
    case "climax":
      // Full 10 modules — every principle matters for climax chapters
      return ["openings","hooks","dialogue","character","pacing","ban","literary","suspense_strategy","scene_texture","bullet_time"];
    case "transition":
      // Core 5 modules — transitions focus on pacing and hooks
      return ["openings","hooks","dialogue","pacing","ban"];
    case "first":
      // 8 modules — first chapters need openings/hooks/character strongly
      return ["openings","hooks","dialogue","character","pacing","ban","literary","suspense_strategy"];
    default:
      // 7 modules — normal chapters drop the 3 most token-heavy extras
      return ["openings","hooks","dialogue","character","pacing","ban","literary"];
  }
}

/** Inject all Skill rules into a system prompt */
export function injectSkillRules(basePrompt: string, modules: string[]): string {
  const rules: Record<string, string> = {
    openings: SKILL_OPENINGS,
    hooks: SKILL_HOOKS,
    dialogue: SKILL_DIALOGUE,
    character: SKILL_CHARACTER,
    pacing: SKILL_PACING,
    ban: SKILL_BAN,
    literary: SKILL_LITERARY,
    suspense_levels: SKILL_SUSPENSE_LEVELS,
    suspense_strategy: SKILL_SUSPENSE_STRATEGY,
    scene_texture: SKILL_SCENE_TEXTURE,
    bullet_time: SKILL_BULLET_TIME,
    fatal_flaw: SKILL_FATAL_FLAW,
    plot_structures: SKILL_PLOT_STRUCTURES,
  };

  let result = basePrompt;
  for (const m of modules) {
    if (rules[m]) result += "\n\n" + rules[m];
  }
  return result;
}
