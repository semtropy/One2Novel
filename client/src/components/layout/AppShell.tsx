import { Outlet } from "react-router-dom";
import { TopBar } from "./TopBar";
import { ErrorBoundary } from "../common/ErrorBoundary";

export function AppShell() {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white">
      <TopBar />
      <main className="flex-1 min-h-0 overflow-hidden px-6 py-4">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
