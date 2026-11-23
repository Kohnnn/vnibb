import type { DividendCoverage } from '@/lib/api';
import { dividendAggregateNote, dividendCoverageText, dividendDiscrepancyText } from '@/lib/dividendHistory';

export function DividendCoverageNotice({ coverage, failed }: {
    coverage: DividendCoverage | null;
    failed?: boolean;
}) {
    const discrepancies = coverage?.discrepancies ?? [];
    const count = coverage?.discrepancy_count ?? 0;

    return (
        <div className="space-y-1 text-xs text-[var(--text-secondary)]">
            {(!failed || coverage?.status === 'partial') && <p>{dividendCoverageText(coverage)}</p>}
            {failed && (
                <p>{coverage?.status === 'partial' ? 'Dividend refresh failed; showing retained results.' : 'Dividend history could not be loaded.'}</p>
            )}
            {count > 0 && (
                <details>
                    <summary className="cursor-pointer">{count} {count === 1 ? 'dividend discrepancy' : 'dividend discrepancies'}</summary>
                    <ul className="list-disc space-y-1 pl-4">
                        {discrepancies.map((item) => (
                            <li key={`${item.dataset}-${item.observation_id}-${item.code}`}>{dividendDiscrepancyText(item)}</li>
                        ))}
                    </ul>
                    {count > discrepancies.length && <p>Showing {discrepancies.length} of {count} discrepancies.</p>}
                </details>
            )}
            <p>{dividendAggregateNote}</p>
        </div>
    );
}
