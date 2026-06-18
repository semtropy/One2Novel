import type { ZodType } from "zod";
import { AppError } from "../../../platform/errors/AppError";

/** Runtime Zod validation — returns 400 with Chinese details on failure */
export function validate<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fieldLabels: Record<string, string> = {
      commercialTags: "商业标签", narrativePov: "视角", pacePreference: "节奏",
      emotionIntensity: "情感强度", genre: "题材", architectureType: "架构类型",
      writingMode: "写作模式", writingScale: "篇幅",
    };
    const details = result.error.issues.map(i => {
      const name = i.path.join(".") || "root";
      const label = fieldLabels[name] ?? name;
      return `${label}: ${i.message === "Required" ? "必填" : i.message}`;
    }).join("; ");
    throw new AppError(400, "VALIDATION_ERROR", `输入数据格式不正确：${details}`);
  }
  return result.data;
}
