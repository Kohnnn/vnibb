'use client';

import { useEffect, useState } from 'react';
import { Sparkles, X, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const STORAGE_KEY = 'vnibb:whats-new-acknowledged:v1';
const CURRENT_RELEASE = 'v1.4.x';

interface ReleaseNote {
  version: string;
  title: string;
  highlights: Array<{
    label: string;
    detail: string;
  }>;
}

const CURRENT_RELEASE_NOTES: ReleaseNote = {
  version: CURRENT_RELEASE,
  title: 'New in v1.4',
  highlights: [
    {
      label: 'Smart Templates',
      detail: 'Save your current dashboard as a template, get AI-recommended layouts based on your activity.',
    },
    {
      label: 'Price Chart fixed',
      detail: 'Resolved the long-standing "no candles" bug — duplicate Mongo rows are now dedup\'d at every layer.',
    },
    {
      label: '5-year Quant history',
      detail: 'Backfilled OHLCV for ~1500 HOSE/HNX/UPCOM tickers, so Seasonality, Sortino, and Drawdown widgets now span 2020–2026.',
    },
    {
      label: 'Real HOSE hours',
      detail: 'VWAP / Footprint / Intraday widgets now use the actual HOSE schedule (09:00–11:30 + 13:00–14:45 ICT).',
    },
    {
      label: 'Smarter Key Metrics',
      detail: 'Beta 63D and TTM Dividend Yield now read from the same source as Quant + Financial Ratios.',
    },
  ],
};

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function loadAcknowledgedVersion(): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistAcknowledgedVersion(version: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, version);
  } catch {
    // ignore
  }
}

/**
 * Lightweight "What's new" panel that appears once per release version.
 * Auto-dismisses on Escape, an explicit dismiss button, or a click on
 * the open button. Persisted via localStorage so it never re-shows
 * unless the user clicks the version label in the sidebar to re-open
 * the panel manually.
 */
export function WhatsNewPanel() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isBrowser()) return;
    const acknowledged = loadAcknowledgedVersion();
    if (acknowledged !== CURRENT_RELEASE) {
      const timer = window.setTimeout(() => setOpen(true), 1500);
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        persistAcknowledgedVersion(CURRENT_RELEASE);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const handleClose = () => {
    setOpen(false);
    persistAcknowledgedVersion(CURRENT_RELEASE);
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0, x: 24, y: 24 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: 24, y: 24 }}
          transition={{ duration: 0.25 }}
          className="fixed bottom-5 right-5 z-[90] w-[360px] max-w-[calc(100vw-40px)] rounded-2xl border border-blue-500/30 bg-[var(--bg-elevated)] shadow-[0_24px_60px_rgba(59,130,246,0.25)]"
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] p-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-blue-500/15 p-1.5 text-blue-300">
                <Sparkles size={14} />
              </div>
              <div>
                <div className="text-[9px] font-black uppercase tracking-[0.2em] text-blue-300">{CURRENT_RELEASE_NOTES.version}</div>
                <h3 className="text-sm font-black text-[var(--text-primary)]">{CURRENT_RELEASE_NOTES.title}</h3>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="Dismiss what's new"
            >
              <X size={14} />
            </button>
          </div>
          <ul className="space-y-2.5 p-3 text-[12px]">
            {CURRENT_RELEASE_NOTES.highlights.map((item) => (
              <li key={item.label} className="flex gap-2">
                <ChevronRight size={12} className="mt-1 shrink-0 text-blue-300" />
                <div>
                  <span className="font-bold text-[var(--text-primary)]">{item.label}.</span>{' '}
                  <span className="text-[var(--text-secondary)]">{item.detail}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] p-3">
            <span className="text-[10px] text-[var(--text-muted)]">Auto-dismisses once you click anywhere.</span>
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white hover:bg-blue-500"
            >
              Got it
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default WhatsNewPanel;
