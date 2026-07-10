import { QueryClient } from "@tanstack/react-query";
import { toast } from "../lib/toast";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
      onError: (error) => {
        const msg = error instanceof Error ? error.message : "操作失败，请重试";
        toast.error(msg);
      },
    },
  },
});
