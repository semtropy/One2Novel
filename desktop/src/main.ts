import path from "node:path";
import { app, BrowserWindow } from "electron";
import { resolveDesktopServerPort, startDesktopServer } from "./runtime/server";
import {
  resolveDesktopAppDataDir,
  resolveDesktopRuntimeConfig,
  resolveDesktopUpdateChannel,
  resolveDesktopWindowIcon,
  resolveRendererDevUrl,
  resolveRendererIndexHtml,
} from "./runtime/paths";

const APP_USER_MODEL_ID = "com.one2novel.desktop";
const MAIN_WINDOW_BACKGROUND = "#0a0f1a";

let mainWindow: BrowserWindow | null = null;
let stopServer: (() => Promise<void>) | null = null;

function focusExistingWindow(): void {
  const targetWindow = mainWindow;
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  if (targetWindow.isMinimized()) {
    targetWindow.restore();
  }
  targetWindow.show();
  targetWindow.focus();
}

function createMainWindow(port: number): BrowserWindow {
  const runtimeConfig = resolveDesktopRuntimeConfig({
    port,
    isPackaged: app.isPackaged,
    appVersion: app.getVersion(),
    updateChannel: resolveDesktopUpdateChannel(),
  });
  process.env.ONE2NOVEL_DESKTOP_RUNTIME = JSON.stringify(runtimeConfig);
  const windowIcon = resolveDesktopWindowIcon();

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: MAIN_WINDOW_BACKGROUND,
    icon: windowIcon,
    title: "One2Novel — AI 小说创作工作台",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ONE2NOVEL_DESKTOP_RENDERER_URL?.trim()) {
    void window.loadURL(resolveRendererDevUrl());
  } else if (!app.isPackaged) {
    void window.loadURL(resolveRendererDevUrl());
  } else {
    void window.loadFile(resolveRendererIndexHtml());
  }

  return window;
}

async function bootstrapDesktopApp(): Promise<void> {
  const port = await resolveDesktopServerPort({ isPackaged: app.isPackaged });
  mainWindow = createMainWindow(port);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const server = await startDesktopServer({ isPackaged: app.isPackaged, port });
  stopServer = server.stop;

  // Server is healthy — show the window
  mainWindow.show();
  mainWindow.focus();
}

function registerAppLifecycle(): void {
  app.setPath("userData", resolveDesktopAppDataDir());
  app.setAppUserModelId(APP_USER_MODEL_ID);

  if (!app.requestSingleInstanceLock()) {
    app.quit();
  }

  app.on("second-instance", () => {
    focusExistingWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    if (stopServer) {
      void stopServer();
    }
  });
}

registerAppLifecycle();

app.whenReady().then(() => {
  bootstrapDesktopApp().catch(async (error) => {
    console.error("[desktop] bootstrap failed.", error);
    app.quit();
  });
});
