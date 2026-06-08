import type { Request, Response, NextFunction } from "express";
import { AppError } from "./AppError";

/** Translate raw technical errors into user-facing Chinese messages */
function toUserMessage(err: Error): string {
  const msg = err.message ?? "";

  // Zod validation errors (LLM returned wrong JSON structure)
  if (msg.includes('"code":"invalid_type"') || msg.includes("invalid_type")) {
    // Extract key field names for better feedback
    const fieldMatches = msg.match(/"path":\s*\[.*?"(\w+)"\]/g);
    const fields = fieldMatches
      ? [...new Set(fieldMatches.map(m => { const match = m.match(/"(\w+)"\]/); return match ? match[1] : ""; }).filter(Boolean))]
      : [];
    if (fields.length > 0) {
      return `AI 生成的格式不正确，缺少字段：${fields.join("、")}。请重试。`;
    }
    return "AI 生成的格式不符合预期，请重试。";
  }

  // JSON parse errors
  if (msg.includes("JSON") || msg.includes("Unexpected token") || msg.includes("Expected")) {
    return "AI 返回的内容无法解析，请重试。";
  }

  // Network / timeout errors
  if (msg.includes("timeout") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("fetch failed")) {
    return "无法连接到 AI 服务，请检查网络或 API Key 配置。";
  }

  // Rate limit
  if (msg.includes("429") || msg.includes("rate") || msg.includes("quota")) {
    return "AI 服务请求过于频繁，请稍后再试。";
  }

  // Auth errors
  if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("Invalid API key")) {
    return "API Key 无效，请在设置中检查配置。";
  }

  // Other errors — truncate long technical messages for the client
  // but ALWAYS log the full error on the server for debugging
  if (msg.length > 150) {
    console.error("[Internal Error — full message]", msg);
    return "AI 生成遇到问题，请重试。如果持续失败，请检查 API Key 配置。";
  }

  return msg;
}

export function errorMiddleware(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    const appErr = err as AppError;
    res.status(appErr.statusCode).json({
      error: {
        code: appErr.code ?? "ERROR",
        message: appErr.message,
        details: appErr.details,
      },
    });
    return;
  }

  console.error("[Unhandled Error]", err.message, err.stack?.slice(0, 300));
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: toUserMessage(err),
    },
  });
}
