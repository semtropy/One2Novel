export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  idempotency = false,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotency ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      result.error?.code || 'HTTP_ERROR',
      result.error?.message || '请求失败',
      result.error?.details,
    );
  return result.data;
}
export type Artifact = {
  id: string;
  kind: string;
  payload: unknown;
  createdAt: string;
  jobId: string | null;
};
export type Content = { id: string; text: string; origin: string; createdAt: string };
export type Chapter = {
  id: string;
  number: number;
  title: string;
  status: string;
  draft: string;
  draftRevision: number;
  activeContentId: string | null;
  versions?: Content[];
};
export type Job = {
  id: string;
  status: string;
  stage: string;
  number: number | null;
  revision: number;
  httpUsed: number;
  httpLimit: number;
  bodyRepairs: number;
  bodyRepairLimit: number;
  deltaRepairs: number;
  deltaRepairLimit: number;
  generationText: string;
  generationComplete: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};
export type Project = {
  id: string;
  title: string;
  idea: string;
  genre: string;
  targetCount: number;
  targetLength: number;
  headChapter: number;
  headSnapshotId: string | null;
  openingId: string | null;
  revision: number;
  status: string;
  updatedAt: string;
  chapters: Chapter[];
  jobs: Job[];
  artifacts: Artifact[];
};

export const active = (j: Job) => ['QUEUED', 'RUNNING'].includes(j.status);
