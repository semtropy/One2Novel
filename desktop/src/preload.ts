import { contextBridge } from "electron";

function readRuntimeConfig(): unknown {
  const rawConfig = process.env.ONE2NOVEL_DESKTOP_RUNTIME?.trim();
  if (!rawConfig) {
    return {};
  }

  try {
    return JSON.parse(rawConfig) as unknown;
  } catch {
    return {};
  }
}

contextBridge.exposeInMainWorld("__ONE2NOVEL_RUNTIME__", readRuntimeConfig());
