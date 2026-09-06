import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, LoaderCircle, X, Settings as SettingsIcon } from 'lucide-react';
export function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <div className="error" role="alert">
      <AlertCircle size={16} />
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </div>
  ) : null;
}

export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={20} />
      正在读取…
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose}>
      <header>
        <h2>{title}</h2>
        <button className="icon" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand">
          <span className="brand-mark">一</span>
          <span>One2Novel</span>
        </Link>
        <span className="header-note">从一句灵感，写到下一章。</span>
        <Link to="/settings" className="text-link">
          <SettingsIcon size={17} />
          <span>模型设置</span>
        </Link>
      </header>
      {children}
    </>
  );
}
