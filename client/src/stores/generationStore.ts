import { create } from "zustand";

interface GenerationState {
  isGenerating: boolean;
  stage: string;
  progress: number;
  buffer: string;
  error: string | null;
  startGeneration: () => void;
  setStage: (stage: string) => void;
  setProgress: (progress: number) => void;
  appendBuffer: (text: string) => void;
  finishGeneration: () => void;
  setError: (error: string) => void;
  reset: () => void;
}

export const useGenerationStore = create<GenerationState>((set) => ({
  isGenerating: false,
  stage: "",
  progress: 0,
  buffer: "",
  error: null,
  startGeneration: () => set({ isGenerating: true, stage: "准备中...", progress: 0, buffer: "", error: null }),
  setStage: (stage) => set({ stage }),
  setProgress: (progress) => set({ progress }),
  appendBuffer: (text) => set((s) => ({ buffer: s.buffer + text })),
  finishGeneration: () => set({ isGenerating: false, stage: "完成", progress: 100 }),
  setError: (error) => set({ isGenerating: false, error }),
  reset: () => set({ isGenerating: false, stage: "", progress: 0, buffer: "", error: null }),
}));
