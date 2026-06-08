import { create } from "zustand";

interface WorkspaceState {
  contextPanelOpen: boolean;
  contextPanelWidth: number;
  toggleContextPanel: () => void;
  setContextPanelWidth: (w: number) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  contextPanelOpen: true,
  contextPanelWidth: 320,
  toggleContextPanel: () => set((s) => ({ contextPanelOpen: !s.contextPanelOpen })),
  setContextPanelWidth: (w) => set({ contextPanelWidth: w }),
}));
