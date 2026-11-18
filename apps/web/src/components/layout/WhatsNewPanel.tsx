'use client';

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, X, ChevronRight, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import CHANGELOG_MARKDOWN from '@/data/changelog.generated';
import { CURRENT_RELEASE, WHATS_NEW_REOPEN_EVENT } from '@/lib/version';

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
  title: `New in ${CURRENT_RELEASE}`,
  highlights: [
    {
      label: 'Templates always work',
      detail: 'Clicking Use Template on a locked default dashboard now silently spins up a new editable workspace.',
    },
    {
      label: 'Financial Statement fixes',
      detail: 'Period normalization is consistent end-to-end so the tab no longer goes blank for partial-data tickers.',
    },
    {
      label: 'Spiral seasonality, refined',
      detail: 'Daily and weekly granularity in one widget. Weekly heatmap drops the "W" prefix everywhere user-facing.',
    },
    {
      label: 'Sturdier technical charts',
      detail: 'TradingView wrappers retry once on script-load failure and fall back to a clear card with a deep-link.',
    },
    {
      label: 'Release notes on demand',
      detail: 'Open the version label in the sidebar whenever you want to read the changelog.',
    },
  ],
};

/** The sidebar version and Settings can open this without interrupting dashboard entry. */
export function WhatsNewPanel() {
  const [open, setOpen] = useState(false);
  const [showFullLog, setShowFullLog] = useState(true);
  const handleClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onReopen = () => {
      setShowFullLog(true);
      setOpen(true);
    };
    window.addEventListener(WHATS_NEW_REOPEN_EVENT, onReopen);
    return () => window.removeEventListener(WHATS_NEW_REOPEN_EVENT, onReopen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) handleClose();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') handleClose();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [open, handleClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0, x: 24, y: 24 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: 24, y: 24 }}
          transition={{ duration: 0.25 }}
          className={`fixed bottom-5 right-5 z-[150] ${showFullLog ? 'w-[480px]' : 'w-[360px]'} max-h-[calc(100dvh-40px)] max-w-[calc(100vw-40px)] overflow-y-auto overscroll-contain rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-lg`}
          role="dialog"
          aria-label="What's new"
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] p-3">
            <div className="flex items-center gap-2">
              <div className="rounded border border-[var(--border-strong)] bg-[var(--bg-secondary)] p-1.5 text-[var(--color-accent-primary)]">
                <Sparkles size={14} />
              </div>
              <div>
                <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-secondary)]">{CURRENT_RELEASE_NOTES.version}</div>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">{CURRENT_RELEASE_NOTES.title}</h3>
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
                <ChevronRight size={12} className="mt-1 shrink-0 text-[var(--color-accent-primary)]" />
                <div>
                  <span className="font-bold text-[var(--text-primary)]">{item.label}.</span>{' '}
                  <span className="text-[var(--text-secondary)]">{item.detail}</span>
                </div>
              </li>
            ))}
          </ul>
          {showFullLog ? (
            <div className="border-t border-[var(--border-subtle)] px-3 pt-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">Full Changelog</div>
              <div className="mt-1 max-h-[50vh] overflow-y-auto pr-2">
                <article className="prose prose-invert prose-sm max-w-none text-[12px] leading-5 [&_h1]:text-sm [&_h2]:text-[13px] [&_h2]:mt-3 [&_h3]:text-[12px] [&_h3]:mt-2 [&_ul]:my-1 [&_li]:my-0.5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{CHANGELOG_MARKDOWN}</ReactMarkdown>
                </article>
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] p-3">
            <button
              type="button"
              onClick={() => setShowFullLog((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1 text-[10px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-expanded={showFullLog}
            >
              <BookOpen size={11} />
              {showFullLog ? 'Hide full changelog' : 'Show full changelog'}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--color-accent-fill)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)]"
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
