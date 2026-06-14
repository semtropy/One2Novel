import type { ZodType } from "zod";

/** C2: Runtime Zod validation — returns 400 on failure instead of 500 from DB constraint */
export function validate<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map(i => `${i.path.join(".") || "root"}: ${i.message}`).join("; ");
    throw Object.assign(new Error(`Validation failed: ${details}`), { statusCode: 400, code: "VALIDATION_ERROR" });
  }
  return result.data;
}
