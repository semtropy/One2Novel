/**
 * Export API hooks — preview + blob download.
 * Split from api/novel.ts
 */
import { useMutation } from "@tanstack/react-query";
import { api } from "../app/api";
import { createQueryHook } from "./factory";

export interface ExportPreview {
  title: string; genre: string | null;
  chapterCount: number; totalChars: number; completedChapters: number;
}

export const useExportPreview = createQueryHook<ExportPreview, string>({
  queryKey: ["export-preview"],
  url: (novelId) => `/novels/${novelId}/export/preview`,
});

// Kept inline: blob response (factory doesn't support responseType)
export function useExportNovel() {
  return useMutation({
    mutationFn: async ({ novelId, format }: { novelId: string; format: string }) => {
      const response = await api.get(`/novels/${novelId}/export`, { params: { format }, responseType: "blob" });
      return response.data;
    },
  });
}
