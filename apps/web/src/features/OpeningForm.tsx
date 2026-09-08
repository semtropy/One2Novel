import type { Opening } from '@one2novel/contracts';

export function OpeningForm({
  value,
  onChange,
  disabled,
}: {
  value: Opening;
  onChange: (value: Opening) => void;
  disabled: boolean;
}) {
  const fields = [
    ['title', '故事名称'],
    ['summary', '全书概要'],
    ['premise', '故事前提'],
    ['centralQuestion', '核心问题'],
    ['endingDirection', '结局方向'],
  ] as const;
  const kinds: Record<string, string> = {
    CHARACTER: '人物',
    LOCATION: '地点',
    ITEM: '物品',
    ORGANIZATION: '组织',
    ABILITY: '能力',
    CONCEPT: '概念',
  };
  return (
    <fieldset className="writing-knowledge-form" disabled={disabled}>
      <legend>故事方向</legend>
      {fields.map(([key, label]) => (
        <label key={key}>
          {label}
          <textarea
            aria-label={label}
            rows={key === 'title' ? 1 : 3}
            value={value.book[key]}
            onChange={(e) => onChange({ ...value, book: { ...value.book, [key]: e.target.value } })}
          />
        </label>
      ))}
      <h3>分卷安排</h3>
      {value.book.volumeDirections.map((v, index) => (
        <label key={index}>
          第 {v.order} 卷 · 第 {v.chapterRange[0]}—{v.chapterRange[1]} 章
          <textarea
            aria-label={`第${v.order}卷目标`}
            rows={3}
            value={v.goal}
            onChange={(e) =>
              onChange({
                ...value,
                book: {
                  ...value.book,
                  volumeDirections: value.book.volumeDirections.map((d, i) =>
                    i === index ? { ...d, goal: e.target.value } : d,
                  ),
                },
              })
            }
          />
        </label>
      ))}
      <h3>开篇前的角色与世界</h3>
      <p className="hint">这里填写开篇前已经成立的设定。未来会发生的变化请写在故事方向中。</p>
      {Object.values(value.state.entities).map((entity) => {
        const update = (key: 'name' | 'description', text: string) =>
          onChange({
            ...value,
            state: {
              ...value.state,
              entities: { ...value.state.entities, [entity.id]: { ...entity, [key]: text } },
            },
          });
        return (
          <section className="knowledge-card" key={entity.id}>
            <h4>
              {kinds[entity.kind]} · {entity.name}
            </h4>
            <label>
              名称
              <input
                aria-label={`${entity.name}名称`}
                value={entity.name}
                onChange={(e) => update('name', e.target.value)}
              />
            </label>
            <label>
              开篇介绍
              <textarea
                aria-label={`${entity.name}开篇介绍`}
                rows={3}
                value={entity.description}
                onChange={(e) => update('description', e.target.value)}
              />
            </label>
          </section>
        );
      })}
    </fieldset>
  );
}
