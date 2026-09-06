import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, ArrowRight, PenLine, LoaderCircle } from 'lucide-react';
import { api, type Project } from '../api';
import { client } from '../query-client';
import { Shell, Modal, ErrorBox, Loading } from '../components/ui';
export function Shelf() {
  const query = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<{ items: Project[] }>('/projects?limit=100'),
  });
  const [creating, setCreating] = useState(false);
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
      {creating && <CreateProject onClose={() => setCreating(false)} />}
    </Shell>
  );
}

function CreateProject({ onClose }: { onClose: () => void }) {
  const nav = useNavigate(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
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
            const p = await api<Project>('/projects', 'POST', {
              title: f.get('title') || '未命名小说',
              idea: f.get('idea'),
              genre: f.get('genre'),
              targetCount: Number(f.get('count')),
              targetLength: Number(f.get('length')),
              requirements: { must: lines('must'), avoid: lines('avoid'), preferences: [] },
            });
            await client.invalidateQueries({ queryKey: ['projects'] });
            nav(`/projects/${p.id}`);
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
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
            <input name="length" type="number" defaultValue={3000} min={500} max={10000} required />
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
        <ErrorBox error={error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}创建小说
          </button>
        </div>
      </form>
    </Modal>
  );
}
