import { createBrowserRouter, createHashRouter, Navigate } from "react-router-dom";
import { APP_RUNTIME } from "../lib/constants";
import { AppShell } from "../components/layout/AppShell";
import { StartPage } from "../pages/StartPage";
import { NovelsPage } from "../pages/NovelsPage";
import { NovelWorkspacePage } from "../pages/NovelWorkspacePage";
import { SettingsPage } from "../pages/SettingsPage";
import { PlanningHubPage } from "../pages/PlanningHubPage";
import { NovelRedirect } from "../pages/NovelRedirect";
import { ReferenceProfilesPage } from "../pages/ReferenceProfilesPage";
import { ReferenceCockpitPage } from "../pages/ReferenceCockpitPage";

const routes = [
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <StartPage /> },
      { path: "/novels", element: <NovelsPage /> },
      { path: "/novels/:novelId", element: <NovelRedirect /> },
      { path: "/novels/:novelId/plan", element: <PlanningHubPage /> },
      { path: "/novels/:novelId/write", element: <NovelWorkspacePage /> },
      { path: "/reference-profiles", element: <ReferenceProfilesPage /> },
      { path: "/reference-profiles/:profileId", element: <ReferenceCockpitPage /> },
      { path: "/settings", element: <SettingsPage /> },
    ],
  },
];

/** Create the appropriate router based on runtime environment */
export function createRouter() {
  return APP_RUNTIME === "desktop" ? createHashRouter(routes) : createBrowserRouter(routes);
}
