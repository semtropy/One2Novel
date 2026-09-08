import { styleSchema, templateSchema } from '@one2novel/contracts';
type Style = ReturnType<typeof styleSchema.parse>;
type Template = ReturnType<typeof templateSchema.parse>;
type Props = { disabled?: boolean; value: any; onChange: (value: any) => void };
const cleanLines = (lines: string[]) => lines.map((s) => s.trim()).filter(Boolean);
export function prepareWritingKnowledge(kind: string, raw: any) {
  if (kind === 'STYLE') {
    const value = styleSchema.parse({
      ...raw,
      tone: cleanLines(raw.tone),
      bannedPhrases: cleanLines(raw.bannedPhrases),
      instructions: cleanLines(raw.instructions),
    });
    if (value.dialogueRatio[0] > value.dialogueRatio[1])
      throw Error('对白比例的最低值不能高于最高值');
    return value;
  }
  return templateSchema.parse({ ...raw, schemaId: raw.target, guidance: cleanLines(raw.guidance) });
}
function Lines({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label>
      {label}
      <textarea
        aria-label={label}
        rows={rows}
        value={value.join('\n')}
        onChange={(e) => onChange(e.target.value.split('\n'))}
        placeholder={placeholder}
      />
      <small className="hint">每行填写一项。</small>
    </label>
  );
}
export function WritingKnowledgeForm({
  kind,
  value,
  onChange,
  disabled,
}: Props & { kind: 'STYLE' | 'TEMPLATE' }) {
  const set = (key: string, next: unknown) => onChange({ ...value, [key]: next });
  if (kind === 'STYLE') {
    const style = value as Style;
    return (
      <fieldset className="writing-knowledge-form" disabled={disabled}>
        <legend>让文字保持你喜欢的声音</legend>
        <p className="hint">
          这些偏好会交给正文写作和审核。禁用表达会额外检查；文学风格与对白比例仍需结合生成结果判断。
        </p>
        <div className="writing-form-grid">
          <label>
            叙述视角
            <select aria-label="叙述视角" value={style.pov} onChange={(e) => set('pov', e.target.value)}>
              <option value="FIRST">第一人称 · 我</option>
              <option value="THIRD_LIMITED">第三人称 · 跟随主要人物</option>
              <option value="OMNISCIENT">全知视角 · 可以切换人物</option>
            </select>
          </label>
          <label>
            叙述时态
            <select aria-label="叙述时态" value={style.tense} onChange={(e) => set('tense', e.target.value)}>
              <option value="PAST">回顾已发生的事</option>
              <option value="PRESENT">描写正在发生的事</option>
            </select>
          </label>
          <label>
            句子长度
            <select
              value={style.sentenceLength}
              aria-label="句子长度"
              onChange={(e) => set('sentenceLength', e.target.value)}
            >
              <option value="SHORT">偏短句 · 简洁利落</option>
              <option value="MIXED">长短结合 · 自然变化</option>
              <option value="LONG">偏长句 · 舒展细腻</option>
            </select>
          </label>
          <Lines
            label="文字气质"
            value={style.tone}
            onChange={(v) => set('tone', v)}
            placeholder={'克制\n有悬念\n温暖'}
            rows={2}
          />
        </div>
        <div className="writing-form-grid">
          <label>
            对白比例最低（%）
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={Math.round(style.dialogueRatio[0] * 100)}
              onChange={(e) =>
                set('dialogueRatio', [Number(e.target.value) / 100, style.dialogueRatio[1]])
              }
            />
          </label>
          <label>
            对白比例最高（%）
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={Math.round(style.dialogueRatio[1] * 100)}
              onChange={(e) =>
                set('dialogueRatio', [style.dialogueRatio[0], Number(e.target.value) / 100])
              }
            />
          </label>
        </div>
        <Lines
          label="避免使用的表达"
          value={style.bannedPhrases}
          onChange={(v) => set('bannedPhrases', v)}
          placeholder={'命运的齿轮开始转动\n不禁倒吸一口凉气'}
        />
        <Lines
          label="其他写作偏好"
          value={style.instructions}
          onChange={(v) => set('instructions', v)}
          placeholder={'通过动作和对话表现情绪，少直接解释人物心情。\n环境描写服务于当下情节。'}
          rows={4}
        />
      </fieldset>
    );
  }
  const template = value as Template;
  const fields: Record<string, string> = {
    summary: template.target === 'CHAPTER' ? '章节目的与节奏' : '整体安排',
    premise: '故事前提',
    centralQuestion: '核心问题',
    endingDirection: '结局方向',
    entrySituation: '进入本卷时的局面',
    exitGoal: '本卷结束时的目标',
    trigger: '事件如何开始',
    opposition: '主要阻碍',
    turn: '关键转折',
    resolutionTarget: '阶段结果',
  };
  const relevant =
    template.target === 'BOOK'
      ? ['summary', 'premise', 'centralQuestion', 'endingDirection']
      : template.target === 'VOLUME'
        ? ['summary', 'entrySituation', 'exitGoal']
        : template.target === 'ARC'
          ? ['summary', 'trigger', 'opposition', 'turn', 'resolutionTarget']
          : ['summary'];
  const shown = [...new Set([...relevant, ...Object.keys(template.defaults)])];
  return (
    <fieldset className="writing-knowledge-form" disabled={disabled}>
      <legend>安排故事怎样展开</legend>
      <p className="hint">
        模板提供可复用的写法，不是每章固定发生的剧情；小说的具体要求和已发生事实始终优先。
      </p>
      <label>
        适用范围
        <select
          value={template.target}
          aria-label="适用范围"
          onChange={(e) =>
            onChange({ ...template, target: e.target.value, schemaId: e.target.value })
          }
        >
          <option value="CHAPTER">章节 · 单章写作</option>
          <option value="ARC">剧情单元 · 一段连续事件</option>
          <option value="VOLUME">卷 · 阶段安排</option>
          <option value="BOOK">全书 · 故事方向</option>
        </select>
      </label>
      {shown.map((key) => (
        <label key={key}>
          {fields[key] || key}
          <textarea
            rows={3}
            value={String(template.defaults[key] ?? '')}
            aria-label={fields[key] || key}
            placeholder="例如：开篇承接上一章的悬念，中段让人物主动行动，结尾带出新的问题。"
            onChange={(e) => set('defaults', { ...template.defaults, [key]: e.target.value })}
          />
        </label>
      ))}
      <Lines
        label="具体写作要求"
        value={template.guidance}
        onChange={(v) => set('guidance', v)}
        placeholder={
          '开篇尽快进入人物的当前处境。\n每章推进一个明确变化，避免只重复已有信息。\n结尾留下自然的疑问，不强行制造反转。'
        }
        rows={6}
      />
    </fieldset>
  );
}
