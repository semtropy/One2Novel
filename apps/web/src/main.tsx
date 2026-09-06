import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { client } from './query-client';
import { Shell } from './components/ui';
import { Shelf } from './pages/Shelf';
import { Workspace } from './pages/Workspace';
import { SettingsPage } from './pages/Settings';
import { Admin } from './pages/Admin';
import './styles.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Shelf />} />
          <Route path="/projects/:id" element={<Workspace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={<Admin />} />
          <Route
            path="*"
            element={
              <Shell>
                <main className="settings-page">
                  <h1>页面不存在</h1>
                  <Link to="/">返回书架</Link>
                </main>
              </Shell>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
