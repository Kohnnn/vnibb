'use client';

import { useState } from 'react';
import { Check, Loader2, ThumbsDown, ThumbsUp } from 'lucide-react';

import {
    submitCopilotFeedback,
  type CopilotFeedbackRequest,
  type CopilotResponseMeta,
} from '@/lib/api';
import { cn } from '@/lib/utils';

interface CopilotFeedbackBarProps {
  responseMeta?: CopilotResponseMeta;
  surface: CopilotFeedbackRequest['surface'];
  currentVote?: 'up' | 'down';
  onVoteChange?: (vote: 'up' | 'down') => void;
  className?: string;
}

export function CopilotFeedbackBar({
  responseMeta,
  surface,
  currentVote,
  onVoteChange,
  className,
}: CopilotFeedbackBarProps) {
    const [pendingVote, setPendingVote] = useState<'up' | 'down' | null>(null);
    const [statusText, setStatusText] = useState<string | null>(null);
    const [notes, setNotes] = useState('');
    const [showNotes, setShowNotes] = useState(false);

  if (!responseMeta?.responseId) {
    return null;
  }

  const submitVote = async (vote: 'up' | 'down') => {
    setPendingVote(vote);
    setStatusText(null);
    try {
      const response = await submitCopilotFeedback({
        responseId: responseMeta.responseId,
        vote,
        surface,
        notes: notes.trim() || undefined,
      });
      onVoteChange?.(vote);
      setStatusText(response.matched ? 'Saved' : 'Saved locally for review');
    } catch {
      setStatusText('Feedback failed');
    } finally {
      setPendingVote(null);
    }
  };

  return (
    <div className={cn('flex items-center justify-between gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/30 px-3 py-2 text-[10px]', className)}>
      <div className="flex-1">
        <div className="flex items-center gap-2 text-[var(--text-muted)]">
          <span>{responseMeta.provider}</span>
          <span>·</span>
          <span>{responseMeta.model}</span>
          <span>·</span>
          <span>{responseMeta.latencyMs} ms</span>
          {statusText && (
            <>
              <span>·</span>
              <span className="text-emerald-300">{statusText}</span>
            </>
          )}
        </div>
        {showNotes && (
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional review note"
            className="mt-2 w-full rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1 text-[10px] text-[var(--text-primary)] outline-none focus:border-cyan-500"
            rows={2}
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowNotes((current) => !current)}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {showNotes ? 'Hide note' : 'Add note'}
        </button>
        <button
          type="button"
          onClick={() => submitVote('up')}
          disabled={Boolean(pendingVote)}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors',
            currentVote === 'up'
              ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
              : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            pendingVote ? 'cursor-not-allowed opacity-70' : '',
          )}
        >
          {pendingVote === 'up' ? <Loader2 size={10} className="animate-spin" /> : currentVote === 'up' ? <Check size={10} /> : <ThumbsUp size={10} />}
          Helpful
        </button>
        <button
          type="button"
          onClick={() => submitVote('down')}
          disabled={Boolean(pendingVote)}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors',
            currentVote === 'down'
              ? 'border-rose-500 bg-rose-500/15 text-rose-300'
              : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            pendingVote ? 'cursor-not-allowed opacity-70' : '',
          )}
        >
          {pendingVote === 'down' ? <Loader2 size={10} className="animate-spin" /> : currentVote === 'down' ? <Check size={10} /> : <ThumbsDown size={10} />}
          Needs work
        </button>
      </div>
    </div>
  );
}

export default CopilotFeedbackBar
