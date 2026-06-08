import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { StartPage } from "../pages/StartPage";
import { NovelsPage } from "../pages/NovelsPage";
import { NovelWorkspacePage } from "../pages/NovelWorkspacePage";
import { SettingsPage } from "../pages/SettingsPage";
import { StylesPage } from "../pages/StylesPage";
import { ChatPage } from "../pages/ChatPage";

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <StartPage /> },
      { path: "/novels", element: <NovelsPage /> },
      { path: "/novels/:novelId", element: <NovelWorkspacePage /> },
      { path: "/chat", element: <ChatPage /> },
      { path: "/styles", element: <StylesPage /> },
      { path: "/settings", element: <SettingsPage /> },
    ],
  },
]);
