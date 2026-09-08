import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, ArrowRight, PenLine, LoaderCircle } from 'lucide-react';
import { api, type Project } from '../api';
import { client } from '../query-client';
import { Shell, Modal, ErrorBox, Loading } from '../components/ui';
export function Shelf() {
  const [params, setParams] = useSearchParams();
  const knowledgeVersionId = params.get('knowledge');
  const query = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<{ items: Project[] }>('/projects?limit=100'),
  });
  const [creating, setCreating] = useState(!!knowledgeVersionId);
  return (
    <Shell>
      <main className="shelf">
        <div className="page-heading">
          <div>
            <div className="eyebrow">你的写作空间</div>
            <h1>小说书架</h1>
            <p>让故事往前走，也让每一次修改有迹可循。</p>
          </div>
          <button className="primary" onClick={() => setCreating(true)}>
            <Plus size={17} />
            新建小说
          </button>
        </div>
        <ErrorBox error={query.error} />
        {query.isPending ? (
          <Loading />
        ) : query.data?.items.length ? (
          <div className="books">
            {query.data.items.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="book-card">
                <div className="book-spine" />
                <div className="book-meta">
                  <span>{p.genre}</span>
                  <span>{p.headChapter ? '创作中' : '等待开篇'}</span>
                </div>
                <h2>{p.title}</h2>
                <p>{p.idea}</p>
                <footer>
                  <span>
                    {p.headChapter} / {p.targetCount} 章
                  </span>
                  <ArrowRight size={18} />
                </footer>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty">
            <div className="empty-paper">
              <PenLine size={28} />
              <i />
              <i />
              <i />
            </div>
            <h2>故事，从这里开始</h2>
            <p>写下一句灵感，再一起规划它的开篇。</p>
            <button className="primary" onClick={() => setCreating(true)}>
              创建第一本小说
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </main>
      {creating && (
        <CreateProject
          knowledgeVersionId={knowledgeVersionId}
          onClose={() => {
            setCreating(false);
            setParams({});
          }}
        />
      )}
    </Shell>
  );
}

function CreateProject({
  onClose,
  knowledgeVersionId,
}: {
  onClose: () => void;
  knowledgeVersionId?: string | null;
}) {
  const nav = useNavigate(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Project | null>(null);
  const knowledge = useQuery({
    queryKey: ['knowledge'],
    queryFn: () =>
      api<{ title: string; versions: { id: string; publishedAt: string | null }[] }[]>(
        '/knowledge',
      ),
    enabled: !!knowledgeVersionId,
  });
  const selectedKnowledge = knowledge.data?.find((i) =>
    i.versions.some((v) => v.id === knowledgeVersionId && v.publishedAt),
  );
  return (
    <Modal title="新建小说" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const f = new FormData(e.currentTarget);
          const lines = (name: string) =>
            String(f.get(name) || '')
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
          try {
            const p =
              created ||
              (await api<Project>('/projects', 'POST', {
                title: f.get('title') || '未命名小说',
                idea: f.get('idea'),
                genre: f.get('genre'),
                targetCount: Number(f.get('count')),
                targetLength: Number(f.get('length')),
                requirements: { must: lines('must'), avoid: lines('avoid'), preferences: [] },
              }));
            setCreated(p);
            await client.invalidateQueries({ queryKey: ['projects'] });
            if (knowledgeVersionId)
              await api(`/projects/${p.id}/knowledge-bindings`, 'PUT', {
                expectedRevision: p.revision,
                versionIds: [knowledgeVersionId],
              });
            nav(`/projects/${p.id}`);
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {knowledgeVersionId && (
          <p className="hint">
            将应用：{selectedKnowledge?.title || '正在读取所选写作资料…'}
            。创建后可在“创作知识”中添加其他风格、模板或参考素材。
          </p>
        )}
        {created && (
          <p className="hint">
            小说已创建；重试只会继续应用资料，不会重复创建。也可关闭后从书架进入。
          </p>
        )}
        <fieldset disabled={!!created} className="project-fields">
          <label>
            小说名称
            <input name="title" placeholder="先取一个工作名" maxLength={100} />
          </label>
          <label>
            一句灵感
            <textarea
              name="idea"
              required
              maxLength={2000}
              rows={4}
              placeholder="一个修复旧钟表的人，发现每座钟里都藏着一段被遗忘的人生……"
            />
          </label>
          <div className="form-row">
            <label>
              题材
              <input name="genre" required defaultValue="悬疑" maxLength={50} />
            </label>
            <label>
              目标章数
              <input name="count" type="number" defaultValue={300} min={1} max={3000} required />
            </label>
            <label>
              每章字数
              <input
                name="length"
                type="number"
                defaultValue={3000}
                min={500}
                max={10000}
                required
              />
            </label>
          </div>
          <details>
            <summary>创作要求与禁区</summary>
            <label>
              必须满足（一行一项）
              <textarea name="must" rows={2} />
            </label>
            <label>
              避免出现（一行一项）
              <textarea name="avoid" rows={2} />
            </label>
          </details>
        </fieldset>
        <ErrorBox error={error || knowledge.error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            disabled={busy || (!!knowledgeVersionId && !selectedKnowledge)}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}创建小说
          </button>
        </div>
      </form>
    </Modal>
  );
}
