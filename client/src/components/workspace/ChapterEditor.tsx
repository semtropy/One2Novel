import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef, useCallback } from "react";

interface Props {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  aiGenerated?: boolean;
  onUserEdit?: () => void;
  onParagraphSelect?: (paragraphs: string[], position?: { top: number; left: number }) => void;
}

function textToHtml(text: string): string {
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  return text.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}

export function ChapterEditor({ content, onChange, placeholder, readOnly, aiGenerated, onUserEdit, onParagraphSelect }: Props) {
  const prevRef = useRef<string | undefined>(undefined);
  const programmaticRef = useRef(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const handleMouseUp = useCallback(() => {
    if (!onParagraphSelect) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      onParagraphSelect([]);
      return;
    }
    const range = sel.getRangeAt(0);

    const findBlock = (node: Node | null): Node | null => {
      while (node && node !== editorRef.current) {
        if (node.nodeType === 1) {
          const el = node as Element;
          const display = window.getComputedStyle(el).display;
          if (display === 'block' || display === 'flex' || display === 'grid' || /^h[1-6]$/i.test(el.tagName) || el.tagName === 'P' || el.tagName === 'DIV' || el.tagName === 'LI') {
            return el;
          }
        }
        node = node.parentNode;
      }
      return null;
    };

    const startBlock = findBlock(range.startContainer);
    const endBlock = findBlock(range.endContainer);
    if (!startBlock || !endBlock) { onParagraphSelect([]); return; }

    const paragraphs: string[] = [];
    let node: Node | null = startBlock;
    while (node) {
      if (node.nodeType === 1) {
        const el = node as Element;
        const display = window.getComputedStyle(el).display;
        if (display === 'block' || display === 'flex' || display === 'grid' || /^h[1-6]$/i.test(el.tagName) || el.tagName === 'P' || el.tagName === 'DIV' || el.tagName === 'LI') {
          const text = el.textContent?.trim();
          if (text && text.length > 0) paragraphs.push(text);
        }
      }
      if (node === endBlock) break;
      node = node.nextSibling;
    }

    if (paragraphs.length === 0) { onParagraphSelect([]); return; }
    if (paragraphs.length === 1 && paragraphs[0].length < 5) { onParagraphSelect([]); return; }

    range.setStartBefore(startBlock);
    range.setEndAfter(endBlock);
    const rect = range.getBoundingClientRect();
    onParagraphSelect(paragraphs, { top: rect.top, left: Math.max(0, rect.left + rect.width / 2 - 130) });
  }, [onParagraphSelect]);

  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: placeholder ?? "..." })],
    content: textToHtml(content),
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
      if (!programmaticRef.current) onUserEdit?.();
    },
  });

  useEffect(() => {
    if (editor && content !== prevRef.current) {
      prevRef.current = content;
      // Don't overwrite if user is actively editing
      if (editor.isFocused) return;
      programmaticRef.current = true;
      editor.commands.setContent(textToHtml(content));
      programmaticRef.current = false;
    }
  }, [content, editor]);

  return (
    <div className="prose prose-slate max-w-none">
      <style>{`
        .ProseMirror { min-height:400px; outline:none; padding:0 1.5rem 1.5rem 1.5rem; font-size:15px; line-height:2; }
        .ProseMirror p { margin:0.5em 0; }
        .ProseMirror p.is-editor-empty:first-child::before { content:attr(data-placeholder); color:#94a3b8; font-style:italic; float:left; pointer-events:none; height:0; }
      `}</style>
      <div ref={editorRef} onMouseUp={handleMouseUp}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
