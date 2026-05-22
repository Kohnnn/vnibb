'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, X, ChevronRight, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import CHANGELOG_MARKDOWN from '@/data/changelog.generated';
import { CURRENT_RELEASE, WHATS_NEW_REOPEN_EVENT } from '@/lib/version';

const STORAGE_KEY = 'vnibb:whats-new-acknowledged:v1';
const AUTO_DISMISS_MS = 5_000;

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
      label: 'This panel grew up',
      detail: 'Auto-dismisses in 5 seconds, closes when you switch tabs, and the full changelog is just below.',
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

function clearAcknowledgedVersion(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Lightweight "What's new" panel that appears once per release version.
 *
 * Behavior contract:
 * - Auto-shows 1500ms after mount unless the user has already acknowledged
 *   the current release.
 * - Auto-dismisses after 5 seconds. Hover or focus pauses the countdown so
 *   the user can read without the panel disappearing under them.
 * - Dismissed when the browser tab loses focus (`visibilitychange`).
 * - Re-opens on demand via the `vnibb:whats-new:reopen` window event,
 *   dispatched from the sidebar version label and the Settings modal.
 * - Renders the inline changelog from `CHANGELOG.md` (synced via
 *   `apps/web/scripts/generate-changelog.mjs`).
 */
export function WhatsNewPanel() {
  const [open, setOpen] = useState(false);
  const [showFullLog, setShowFullLog] = useState(false);
  const dismissTimerRef = useRef<number | null>(null);
  const isPausedRef = useRef(false);

  const dismiss = useCallback((persist = true) => {
    setOpen(false);
    setShowFullLog(false);
    if (persist) persistAcknowledgedVersion(CURRENT_RELEASE);
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const armAutoDismiss = useCallback(() => {
    if (!isBrowser()) return;
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
    }
    dismissTimerRef.current = window.setTimeout(() => {
      if (!isPausedRef.current) {
        dismiss(true);
      }
    }, AUTO_DISMISS_MS);
  }, [dismiss]);

  // Auto-show on first mount per release.
  useEffect(() => {
    if (!isBrowser()) return;
    const acknowledged = loadAcknowledgedVersion();
    if (acknowledged !== CURRENT_RELEASE) {
      const timer = window.setTimeout(() => setOpen(true), 1500);
      return () => window.clearTimeout(timer);
    }
  }, []);

  // Arm the auto-dismiss timer whenever the panel opens. Re-arming on
  // `showFullLog` toggle keeps the user from being surprised mid-scroll.
  useEffect(() => {
    if (!open) return;
    if (showFullLog) {
      // While the user is reading the full changelog, do not auto-dismiss.
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      return;
    }
    armAutoDismiss();
    return () => {
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [open, showFullLog, armAutoDismiss]);

  // Keyboard close.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismiss(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismiss]);

  // Dismiss when the user switches browser tabs.
  useEffect(() => {
    if (!open) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        dismiss(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [open, dismiss]);

  // Manual reopen handler.
  useEffect(() => {
    if (!isBrowser()) return;
    const onReopen = () => {
      clearAcknowledgedVersion();
      setShowFullLog(true);
      setOpen(true);
    };
    window.addEventListener(WHATS_NEW_REOPEN_EVENT, onReopen);
    return () => window.removeEventListener(WHATS_NEW_REOPEN_EVENT, onReopen);
  }, []);

  const handleClose = useCallback(() => {
    dismiss(true);
  }, [dismiss]);

  const handlePauseAutoDismiss = useCallback(() => {
    isPausedRef.current = true;
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const handleResumeAutoDismiss = useCallback(() => {
    isPausedRef.current = false;
    if (open && !showFullLog) {
      armAutoDismiss();
    }
  }, [open, showFullLog, armAutoDismiss]);

  const fullLogMarkdown = useMemo(() => CHANGELOG_MARKDOWN, []);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0, x: 24, y: 24 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: 24, y: 24 }}
          transition={{ duration: 0.25 }}
          className={`fixed bottom-5 right-5 z-[90] ${showFullLog ? 'w-[480px]' : 'w-[360px]'} max-w-[calc(100vw-40px)] rounded-2xl border border-blue-500/30 bg-[var(--bg-elevated)] shadow-[0_24px_60px_rgba(59,130,246,0.25)]`}
          onMouseEnter={handlePauseAutoDismiss}
          onMouseLeave={handleResumeAutoDismiss}
          onFocusCapture={handlePauseAutoDismiss}
          onBlurCapture={handleResumeAutoDismiss}
          role="dialog"
          aria-label="What's new"
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
          {showFullLog ? (
            <div className="border-t border-[var(--border-subtle)] px-3 pt-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">Full Changelog</div>
              <div className="mt-1 max-h-[50vh] overflow-y-auto pr-2">
                <article className="prose prose-invert prose-sm max-w-none text-[12px] leading-5 [&_h1]:text-sm [&_h2]:text-[13px] [&_h2]:mt-3 [&_h3]:text-[12px] [&_h3]:mt-2 [&_ul]:my-1 [&_li]:my-0.5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{fullLogMarkdown}</ReactMarkdown>
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
