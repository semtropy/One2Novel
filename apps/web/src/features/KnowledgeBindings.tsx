import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type Project } from '../api';
import { Modal, ErrorBox } from '../components/ui';
export function KnowledgeBindings({ project, onClose }: { project: Project; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['knowledge'],
    queryFn: () =>
      api<
        {
          id: string;
          kind: string;
          title: string;
          versions: { id: string; number: number; publishedAt: string | null; payload: any }[];
        }[]
      >('/knowledge'),
  });
  const current = useQuery({
    queryKey: ['bindings', project.id],
    queryFn: () =>
      api<{ items: { versionId: string }[] }>(`/projects/${project.id}/knowledge-bindings`),
  });
  const [selection, setSelection] = useState<string[] | null>(null),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    qc = useQueryClient();
  const ids = selection ?? current.data?.items.map((i) => i.versionId) ?? [];
  return (
    <Modal title="这本小说的创作知识" onClose={onClose}>
      <p>选择已发布的固定版本。素材包需先完成改编；绑定只影响后续规划，不会直接修改故事事实。</p>
      <ErrorBox error={error || q.error || current.error} />
      <div className="binding-list">
        {q.data?.flatMap((item) =>
          item.versions
            .filter(
              (v) => v.publishedAt && (item.kind !== 'ASSET_PACK' || v.payload.stage === 'ADAPTED'),
            )
            .map((v) => (
              <label key={v.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(v.id)}
                  onChange={(e) =>
                    setSelection(
                      e.target.checked ? [...ids, v.id] : ids.filter((id) => id !== v.id),
                    )
                  }
                />
                <span>
                  {item.title}
                  <small>
                    第 {v.number} 版 ·{' '}
                    {
                      (
                        {
                          FRAMEWORK: '叙事框架',
                          ASSET_PACK: '改编素材',
                          STYLE: '文字风格',
                          TEMPLATE: '规划模板',
                        } as Record<string, string>
                      )[item.kind]
                    }
                  </small>
                </span>
              </label>
            )),
        )}
      </div>
      <p className="hint">最多1份框架、3份素材包、1份风格及每层级1份模板。</p>
      <div className="actions">
        <Link className="button" to="/library">
          管理参考与知识
        </Link>
        <button
          className="primary"
          disabled={busy || !current.data}
          onClick={() => {
            setBusy(true);
            void api(`/projects/${project.id}/knowledge-bindings`, 'PUT', {
              expectedRevision: project.revision,
              versionIds: ids,
            })
              .then(async () => {
                await qc.invalidateQueries({ queryKey: ['project', project.id] });
                await qc.invalidateQueries({ queryKey: ['bindings', project.id] });
                onClose();
              })
              .catch(setError)
              .finally(() => setBusy(false));
          }}
        >
          保存知识绑定
        </button>
      </div>
    </Modal>
  );
}
