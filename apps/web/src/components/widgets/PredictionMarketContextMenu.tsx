'use client';

import { Bookmark, BookmarkCheck, Copy, ExternalLink, FileSearch } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
    usePredictionMarketWatchlist,
    watchlistKey,
} from './prediction-market-ui';

export interface PredictionMarketRowLike {
    readonly source: string;
    readonly sourceId: string;
    readonly question: string;
    readonly url: string | null;
    readonly outcomePrice?: number | null;
}

export interface PredictionMarketContextMenuProps {
    readonly market: PredictionMarketRowLike;
    readonly onOpenDrawer?: () => void;
    readonly children: React.ReactNode;
}

interface MenuPos {
    readonly x: number;
    readonly y: number;
}

function copy(value: string): void {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(value).catch(() => undefined);
}

export function PredictionMarketContextMenu({
    market,
    onOpenDrawer,
    children,
}: PredictionMarketContextMenuProps) {
    const [open, setOpen] = useState<MenuPos | null>(null);
    const ref = useRef<HTMLDivElement | null>(null);
    const watchlist = usePredictionMarketWatchlist();
    const key = watchlistKey(market);
    const watching = watchlist.isWatching(key);

    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent && event.key === 'Escape') {
                setOpen(null);
                return;
            }
            if (ref.current && event instanceof MouseEvent && ref.current.contains(event.target as Node)) {
                return;
            }
            setOpen(null);
        };
        window.addEventListener('click', close);
        window.addEventListener('contextmenu', close);
        window.addEventListener('keydown', close);
        return () => {
            window.removeEventListener('click', close);
            window.removeEventListener('contextmenu', close);
            window.removeEventListener('keydown', close);
        };
    }, [open]);

    return (
        <div
            ref={ref}
            className="relative"
            onContextMenu={(event) => {
                event.preventDefault();
                setOpen({ x: event.clientX, y: event.clientY });
            }}
            onKeyDown={(event) => {
                if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
                    const target = event.currentTarget;
                    const rect = target.getBoundingClientRect();
                    setOpen({ x: rect.left, y: rect.top });
                }
            }}
        >
            {children}
            {open && (
                <div
                    role="menu"
                    aria-label="Prediction market actions"
                    className="fixed z-50 min-w-[200px] rounded-lg border border-default bg-[var(--bg-primary)] py-1 text-xs shadow-xl"
                    style={{ left: open.x, top: open.y }}
                >
                    {onOpenDrawer && (
                        <button
                            type="button"
                            onClick={() => {
                                setOpen(null);
                                onOpenDrawer();
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                        >
                            <FileSearch size={12} aria-hidden />
                            Open in drawer
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => {
                            const link =
                                market.url ??
                                `${typeof window !== 'undefined' ? window.location.origin : ''}/?market=${encodeURIComponent(`${market.source}:${market.sourceId}`)}`;
                            copy(link);
                            setOpen(null);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    >
                        <Copy size={12} aria-hidden />
                        Copy market link
                    </button>
                    {market.url && (
                        <a
                            href={market.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => setOpen(null)}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                        >
                            <ExternalLink size={12} aria-hidden />
                            Open on {market.source}
                        </a>
                    )}
                    <button
                        type="button"
                        onClick={() => {
                            watchlist.toggle(key);
                            setOpen(null);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    >
                        {watching ? (
                            <BookmarkCheck size={12} aria-hidden className="text-amber-300" />
                        ) : (
                            <Bookmark size={12} aria-hidden />
                        )}
                        {watching ? 'Remove from watchlist' : 'Add to watchlist'}
                    </button>
                </div>
            )}
        </div>
    );
}