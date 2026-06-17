/**
 * Thin hook factory — collapses repetitive React Query patterns into config-driven factories.
 *
 * Before: 30+ hooks each repeating the same ~10-line useQuery/useMutation template.
 * After:  each hook is a 3-5 line factory call. The repetition lives in the factory,
 *         not in every hook definition.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../app/api";

// ═══════════════════════════════════════════════════════════
// Query Factory
// ═══════════════════════════════════════════════════════════

interface QueryHookConfig<TData, TParams> {
  /** Static query key prefix (dynamic segments like ids are appended from params) */
  queryKey: readonly string[];
  /** Build the full query key from params (default: identity — params becomes the last key segment) */
  queryKeyFn?: (params: TParams) => readonly unknown[];
  /** Build the API URL from params */
  url: (params: TParams) => string;
  /** Enable guard. Default: !!params (truthy check). Pass () => true for list queries. */
  enabled?: (params: TParams) => boolean;
  /** Optional overrides */
  staleTime?: number;
  refetchOnMount?: boolean | "always";
}

/**
 * Create a useQuery hook from a config object.
 *
 * Usage:
 *   export const useNovel = createQueryHook<NovelDetail, string>({
 *     queryKey: ["novel"],
 *     url: (id) => `/novels/${id}`,
 *   });
 */
export function createQueryHook<TData, TParams = string | undefined>(
  config: QueryHookConfig<TData, TParams>,
) {
  return function useQueryHook(params: TParams) {
    const key = config.queryKeyFn
      ? config.queryKeyFn(params)
      : [...config.queryKey, params] as const;

    return useQuery({
      queryKey: key,
      queryFn: async () => {
        const { data } = await api.get(config.url(params));
        return data.data as TData;
      },
      enabled: config.enabled ? config.enabled(params) : !!params,
      ...(config.staleTime !== undefined ? { staleTime: config.staleTime } : {}),
      ...(config.refetchOnMount !== undefined ? { refetchOnMount: config.refetchOnMount } : {}),
    });
  };
}

// ═══════════════════════════════════════════════════════════
// Mutation Factory
// ═══════════════════════════════════════════════════════════

type HttpMethod = "post" | "patch" | "put" | "delete";

interface MutationHookConfig<TInput, TOutput> {
  /** HTTP method */
  method: HttpMethod;
  /** Build the API URL from the mutation input */
  url: (input: TInput) => string;
  /** Build the request body from input. Default: input (pass identity). Set to () => undefined for no-body calls. */
  body?: (input: TInput) => unknown;
  /** Query keys to invalidate on success (each inner array is one invalidateQueries call) */
  invalidateKeys?: (input: TInput) => string[][];
  /** Optional: override the default response transformer (default: data => data.data) */
  transform?: (data: unknown) => TOutput;
}

/**
 * Create a useMutation hook from a config object.
 *
 * Usage:
 *   export const useDeleteNovel = createMutationHook<{ id: string }, void>({
 *     method: "delete",
 *     url: (input) => `/novels/${input.id}`,
 *     invalidateKeys: (input) => [["novels"], ["novel", input.id]],
 *   });
 */
export function createMutationHook<TInput, TOutput = unknown>(
  config: MutationHookConfig<TInput, TOutput>,
) {
  return function useMutationHook() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: async (input: TInput) => {
        const body = config.body ? config.body(input) : input;
        // post/patch/put accept (url, data); get/delete interpret second arg as config
        const needsBody = config.method === "post" || config.method === "patch" || config.method === "put";
        const { data } = needsBody
          ? await (api[config.method] as (url: string, data: unknown) => Promise<{ data: unknown }>)(config.url(input), body)
          : await api[config.method](config.url(input));
        return (config.transform ? config.transform(data) : data.data) as TOutput;
      },
      onSuccess: (_data, variables) => {
        if (config.invalidateKeys) {
          const keys = config.invalidateKeys(variables);
          for (const key of keys) {
            qc.invalidateQueries({ queryKey: key });
          }
        }
      },
    });
  };
}
