import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "./app/router";
import { queryClient } from "./app/queryClient";
import DesktopBootstrapBoundary from "./components/layout/DesktopBootstrapBoundary";
import "./index.css";

const router = createRouter();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DesktopBootstrapBoundary>
        <RouterProvider router={router} />
      </DesktopBootstrapBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
