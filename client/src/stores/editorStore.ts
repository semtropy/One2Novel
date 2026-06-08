import { create } from "zustand";

interface EditorState {
  activeChapterId: string | null;
  content: string;
  isDirty: boolean;
  setActiveChapter: (id: string | null) => void;
  setContent: (content: string) => void;
  markClean: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeChapterId: null,
  content: "",
  isDirty: false,
  setActiveChapter: (id) => set({ activeChapterId: id, content: "", isDirty: false }),
  setContent: (content) => set({ content, isDirty: true }),
  markClean: () => set({ isDirty: false }),
}));
