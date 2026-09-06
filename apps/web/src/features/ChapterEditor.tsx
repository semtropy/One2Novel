import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { RotateCcw, PenLine, Check, Play, ArrowRight } from 'lucide-react';
import { api, ApiError, active, type Project, type Chapter, type Job } from '../api';
import { ErrorBox } from '../components/ui';
export function ChapterEditor({
  project: p,
  number,
  job,
  busy,
  onAction,
  onWrite,
  onRewrite,
}: {
  project: Project;
  number: number;
  job?: Job;
  busy: boolean;
  onAction: (fn: () => Promise<unknown>) => Promise<void>;
  onWrite: (x: { mode: string; draftRevision: number | null }) => Promise<void>;
  onRewrite: () => Promise<void>;
}) {
  const q = useQuery({
    queryKey: ['chapter', p.id, number],
    queryFn: () => api<Chapter>(`/projects/${p.id}/chapters/${number}`),
    retry: false,
    refetchInterval: job && active(job) ? 2000 : false,
  });
  const [draft, setDraft] = useState(''),
    [initialized, setInitialized] = useState(false),
    [saved, setSaved] = useState(''),
    [saveError, setSaveError] = useState<unknown>(),
    [status, setStatus] = useState(''),
    [history, setHistory] = useState(false),
    [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const revision = useRef(0),
    saveLock = useRef(false),
    latest = useRef('');
  const cacheKey = 'one2novel-draft:' + p.id + ':' + number;
  const chapter = q.data,
    committed = !!chapter?.activeContentId,
    version = chapter?.versions?.find((v) => v.id === (selectedVersion || chapter.activeContentId)),
    live = job?.number === number && active(job) ? job.generationText : null;
  useEffect(() => {
    if (initialized) return;
    if (chapter || (q.error instanceof ApiError && q.error.code === 'NOT_FOUND')) {
      const serverText =
        chapter?.draft ||
        chapter?.versions?.find((v) => v.id === chapter.activeContentId)?.text ||
        '';
      let local: { text: string; baseRevision: number } | null = null;
      try {
        local = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      } catch {}
      const text = local?.text ?? serverText;
      revision.current = chapter?.draftRevision || 0;
      if (local && local.baseRevision !== revision.current && local.text !== serverText)
        setSaveError(new Error('本地未保存文本与服务端版本不同，请先导出或明确重新保存。'));
      setDraft(text);
      latest.current = text;
      setSaved(serverText);
      setInitialized(true);
    }
  }, [chapter, q.error, initialized]);
  const save = async () => {
    if (saveLock.current) throw new Error('草稿正在保存，请稍后再试');
    if (latest.current === saved) return revision.current;
    saveLock.current = true;
    setStatus('保存中…');
    try {
      const sent = latest.current,
        result = await api<Chapter>(`/projects/${p.id}/chapters/${number}/draft`, 'PUT', {
          text: sent,
          expectedRevision: revision.current,
        });
      revision.current = result.draftRevision;
      setSaved(sent);
      if (latest.current === sent) sessionStorage.removeItem(cacheKey);
      else
        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({ text: latest.current, baseRevision: result.draftRevision }),
        );
      setStatus('已保存');
      setSaveError(null);
      return result.draftRevision;
    } catch (e) {
      setSaveError(e);
      setStatus('未保存');
      throw e;
    } finally {
      saveLock.current = false;
    }
  };
  useEffect(() => {
    if (!initialized || draft === saved || saveError || committed || selectedVersion) return;
    const timer = setTimeout(() => void save().catch(() => {}), 1000);
    return () => clearTimeout(timer);
  }, [draft, saved, initialized, saveError, committed, selectedVersion]);
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (latest.current !== saved) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [saved]);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        bold: false,
        italic: false,
        strike: false,
        horizontalRule: false,
      }),
    ],
    content: '',
    editable: false,
    editorProps: {
      attributes: {
        'aria-label': '章节正文',
        role: 'textbox',
        'aria-multiline': 'true',
        class: 'manuscript',
        'data-placeholder': '写下本章的第一句，或让故事根据规划展开……',
      },
    },
    onUpdate: ({ editor }) => {
      const t = editor.getText({ blockSeparator: '\n\n' });
      latest.current = t;
      setDraft(t);
      sessionStorage.setItem(cacheKey, JSON.stringify({ text: t, baseRevision: revision.current }));
    },
  });
  const readonly = committed || !!selectedVersion || live !== null;
  useEffect(() => {
    if (!editor || !initialized) return;
    editor.setEditable(!readonly, false);
    const text = live !== null ? live : version ? version.text : draft;
    if (editor.getText({ blockSeparator: '\n\n' }) !== text)
      editor.commands.setContent(
        {
          type: 'doc',
          content: text.split(/\n\n/).map((t) => ({
            type: 'paragraph',
            ...(t ? { content: [{ type: 'text', text: t }] } : {}),
          })),
        },
        false,
      );
  }, [editor, initialized, readonly, live, version?.id]);
  const displayed = live !== null ? live : version?.text || draft;
  return (
    <>
      <div className="editor-toolbar">
        <span className="eyebrow">第 {String(number).padStart(2, '0')} 章</span>
        <div>
          <button className="text-link" onClick={() => setHistory(!history)}>
            <RotateCcw size={14} />
            版本
          </button>
          {committed && (
            <button className="text-link" disabled={busy} onClick={() => void onAction(onRewrite)}>
              <PenLine size={14} />
              重写
            </button>
          )}
        </div>
      </div>
      {history && (
        <div className="history-list">
          <button onClick={() => setSelectedVersion(null)}>当前正文 / 工作草稿</button>
          {chapter?.versions?.map((v, i) => (
            <button key={v.id} onClick={() => setSelectedVersion(v.id)}>
              {chapter.versions!.length - i} · {v.origin}{' '}
              {v.id === chapter.activeContentId ? '· 正式版本' : ''}
            </button>
          ))}
        </div>
      )}
      <div className="manuscript-title">
        <h2>{chapter?.title || `第${number}章`}</h2>
        <span>
          {committed ? (
            <>
              <Check size={13} />
              已提交
            </>
          ) : live !== null ? (
            '正在生成'
          ) : selectedVersion ? (
            '历史候选'
          ) : (
            '工作草稿'
          )}
        </span>
      </div>
      <ErrorBox error={saveError} />
      {!!saveError && (
        <div className="actions">
          <button
            onClick={() => {
              const blob = new Blob([draft], { type: 'text/plain;charset=utf-8' }),
                u = URL.createObjectURL(blob),
                a = document.createElement('a');
              a.href = u;
              a.download = `第${number}章-draft.txt`;
              a.click();
              URL.revokeObjectURL(u);
            }}
          >
            导出本地草稿
          </button>
          <button
            onClick={async () => {
              const result = await q.refetch();
              if (result.data) {
                revision.current = result.data.draftRevision;
                setSaveError(null);
              }
            }}
          >
            保留本地文本并重新保存
          </button>
        </div>
      )}
      {!committed && !busy && job?.number === number && job.generationText && (
        <button
          className="text-link"
          onClick={() => {
            setSelectedVersion(null);
            const t = job.generationText;
            latest.current = t;
            setDraft(t);
            sessionStorage.setItem(
              cacheKey,
              JSON.stringify({ text: t, baseRevision: revision.current }),
            );
            editor?.commands.setContent(
              {
                type: 'doc',
                content: t.split(/\n\n/).map((text) => ({
                  type: 'paragraph',
                  ...(text ? { content: [{ type: 'text', text }] } : {}),
                })),
              },
              false,
            );
          }}
        >
          载入上次生成的正文到草稿
        </button>
      )}
      <EditorContent editor={editor} />
      <div className="editor-footer">
        <span>
          {[...displayed].filter((c) => !/\s/u.test(c)).length.toLocaleString()} 字 <i />{' '}
          {committed ? '正式版本只读' : status}
        </span>
        <div>
          {!committed && !selectedVersion && (
            <button
              disabled={busy || !draft.trim()}
              onClick={() =>
                void onAction(async () => {
                  const r = await save();
                  await onWrite({ mode: 'AUDIT_DRAFT', draftRevision: r });
                })
              }
            >
              审核并提交草稿
            </button>
          )}
          {number === p.headChapter + 1 && (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void onAction(() => onWrite({ mode: 'GENERATE', draftRevision: null }))
              }
            >
              <Play size={14} />
              {busy ? '任务执行中' : '生成本章'}
            </button>
          )}
          {committed && p.headChapter < p.targetCount && (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void onAction(() => onWrite({ mode: 'GENERATE', draftRevision: null }))
              }
            >
              写下一章
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
