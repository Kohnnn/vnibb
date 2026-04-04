'use client';

import { useEffect, useState } from 'react';
import { Database, MessageSquareWarning, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';

import { getAdminAITelemetry, type AdminAITelemetryRecord } from '@/lib/api';
import { formatAbsoluteTimestamp } from '@/lib/format';

interface AICopilotTelemetryReviewProps {
  adminKey: string;
  enabled: boolean;
}

export function AICopilotTelemetryReview({ adminKey, enabled }: AICopilotTelemetryReviewProps) {
  const [records, setRecords] = useState<AdminAITelemetryRecord[]>([]);
  const [summary, setSummary] = useState<{
    total: number;
    feedback_total: number;
    positive_feedback: number;
    negative_feedback: number;
    acceptance_rate?: number | null;
    average_latency_ms?: number | null;
    artifact_ratings?: { liked: number; disliked: number };
    providers?: string[];
    models?: string[];
    symbols?: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [symbolFilter, setSymbolFilter] = useState('');
  const [voteFilter, setVoteFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  const fetchTelemetry = async () => {
    if (!enabled || !adminKey.trim()) {
      return;
    }
    setLoading(true);
    try {
      const response = await getAdminAITelemetry(adminKey.trim(), 25, {
        provider: providerFilter || undefined,
        model: modelFilter || undefined,
        symbol: symbolFilter || undefined,
        vote: voteFilter || undefined,
        search: searchFilter || undefined,
      });
      setRecords(response.data || []);
      setSummary(response.summary || null);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load AI telemetry');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTelemetry();
  }, [adminKey, enabled, modelFilter, providerFilter, searchFilter, symbolFilter, voteFilter]);

  if (!enabled) {
    return null;
  }

  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-[var(--text-primary)]">VniAgent Telemetry Review</div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            Review recent copilot responses, feedback votes, and artifact/action outcomes captured in this API process.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void fetchTelemetry()}
          disabled={loading}
          className="rounded-lg border border-[var(--border-default)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="inline-flex items-center gap-1">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </span>
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      {summary && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Responses</div>
            <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{summary.total}</div>
          </div>
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Feedback</div>
            <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{summary.feedback_total}</div>
          </div>
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Acceptance</div>
            <div className="mt-1 text-lg font-semibold text-emerald-300">{summary.acceptance_rate ?? '—'}{summary.acceptance_rate !== null && summary.acceptance_rate !== undefined ? '%' : ''}</div>
          </div>
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Avg latency</div>
            <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{summary.average_latency_ms ?? '—'}</div>
          </div>
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Artifact ratings</div>
            <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">👍 {summary.artifact_ratings?.liked || 0} / 👎 {summary.artifact_ratings?.disliked || 0}</div>
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
        <input
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
          placeholder="Provider"
          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-cyan-500"
        />
        <input
          value={modelFilter}
          onChange={(event) => setModelFilter(event.target.value)}
          placeholder="Model"
          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-cyan-500"
        />
        <input
          value={symbolFilter}
          onChange={(event) => setSymbolFilter(event.target.value.toUpperCase())}
          placeholder="Symbol"
          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-cyan-500"
        />
        <select
          value={voteFilter}
          onChange={(event) => setVoteFilter(event.target.value)}
          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-cyan-500"
        >
          <option value="">All votes</option>
          <option value="up">Helpful</option>
          <option value="down">Needs work</option>
        </select>
        <input
          value={searchFilter}
          onChange={(event) => setSearchFilter(event.target.value)}
          placeholder="Search prompt or notes"
          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-cyan-500"
        />
      </div>

      {!loading && !error && records.length === 0 && (
        <div className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-xs text-[var(--text-muted)]">
          No AI telemetry records captured yet in this process.
        </div>
      )}

      <div className="mt-4 space-y-3">
        {records.map((record) => (
          <div key={record.response_id} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
              <span className="font-mono text-cyan-300">{record.response_id}</span>
              <span>·</span>
              <span>{record.provider}</span>
              <span>·</span>
              <span>{record.model}</span>
              <span>·</span>
              <span>{record.latency_ms} ms</span>
              <span>·</span>
              <span>{formatAbsoluteTimestamp(record.created_at)}</span>
            </div>

            <div className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
              {record.prompt_preview || 'No prompt preview available'}
            </div>

            <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--text-secondary)]">
              {record.current_symbol ? <span className="rounded-full border border-blue-500/20 px-2 py-1 text-blue-300">{record.current_symbol}</span> : null}
              <span className="rounded-full border border-[var(--border-default)] px-2 py-1">
                {record.used_source_ids.length} sources
              </span>
              <span className="rounded-full border border-[var(--border-default)] px-2 py-1">
                {record.artifact_ids.length} artifacts
              </span>
              <span className="rounded-full border border-[var(--border-default)] px-2 py-1">
                {record.action_ids.length} actions
              </span>
              <span className="rounded-full border border-[var(--border-default)] px-2 py-1">
                {record.reasoning_events.length} reasoning events
              </span>
            </div>

            {record.feedback && (
              <div className="mt-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                <div className="flex items-center gap-2 text-[var(--text-primary)]">
                  {record.feedback.vote === 'up' ? <ThumbsUp size={12} className="text-emerald-300" /> : <ThumbsDown size={12} className="text-rose-300" />}
                  <span className="font-semibold uppercase tracking-wide">Feedback</span>
                  <span className="text-[10px] text-[var(--text-muted)]">{record.feedback.surface}</span>
                </div>
                {record.feedback.notes && (
                  <div className="mt-2 text-[11px] text-[var(--text-secondary)]">{record.feedback.notes}</div>
                )}
                {record.feedback.reasons?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                    {record.feedback.reasons.map((reason) => (
                      <span key={`${record.response_id}-${reason}`} className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-rose-200">
                        {reason}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {record.outcomes?.length ? (
              <div className="mt-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                <div className="flex items-center gap-2 text-[var(--text-primary)]">
                  <Database size={12} className="text-cyan-300" />
                  <span className="font-semibold uppercase tracking-wide">Outcomes</span>
                </div>
                <div className="mt-2 space-y-2">
                  {record.outcomes.map((outcome, index) => (
                    <div key={`${record.response_id}-${outcome.kind}-${outcome.item_id}-${index}`} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-[10px]">
                        <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 uppercase tracking-wide">{outcome.kind}</span>
                        <span className="font-mono text-cyan-300">{outcome.item_id}</span>
                        <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5">{outcome.status}</span>
                        <span className="text-[var(--text-muted)]">{outcome.surface}</span>
                      </div>
                      {outcome.notes ? (
                        <div className="mt-2 text-[11px] text-[var(--text-secondary)]">{outcome.notes}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {!records.length && !loading && !error && (
        <div className="mt-4 flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <MessageSquareWarning size={14} />
          AI review data will appear after copilot responses are generated in this runtime.
        </div>
      )}
    </div>
  );
}

export default AICopilotTelemetryReview
