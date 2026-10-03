'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { readResearchShare, type ResearchShareRead } from '@/lib/researchSharing';

export function ResearchShareViewer({ shareId }: { shareId: string }) {
    const { user, loading } = useAuth();
    const [snapshot, setSnapshot] = useState<{ userId: string; shareId: string; share: ResearchShareRead } | null>(null);
    const [error, setError] = useState('');
    const [refresh, setRefresh] = useState(0);
    const signedIn = user?.provider === 'supabase';

    useEffect(() => {
        setSnapshot(null);
        setError('');
        if (!signedIn || !user) return;
        const controller = new AbortController();
        const userId = user.id;
        void readResearchShare(shareId, controller.signal).then((share) => {
            if (!controller.signal.aborted) setSnapshot({ userId, shareId, share });
        }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Research share is unavailable.'); });
        const onVisibility = () => { if (document.visibilityState === 'visible') setRefresh((value) => value + 1); };
        document.addEventListener('visibilitychange', onVisibility);
        const interval = window.setInterval(() => setRefresh((value) => value + 1), 60000);
        return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisibility); };
    }, [shareId, signedIn, user?.id, refresh]);

    const share = signedIn && snapshot && snapshot.shareId === shareId && snapshot.userId === user?.id && Date.parse(snapshot.share.expires_at) > Date.now() ? snapshot.share : null;
    return <main className="mx-auto max-w-3xl px-5 py-10 text-[var(--text-primary)]">
        <Link href="/dashboard" className="text-sm underline">Return to your workspace</Link>
        <h1 className="mt-6 text-2xl font-semibold">Frozen Investment Thesis</h1>
        <p className="mt-3 text-sm leading-6">Recipient-only, read-only research. No editing or import is available. This is authored text, not a grant to underlying source evidence or proof of content origin.</p>
        {loading ? <p role="status" className="mt-6">Checking sign-in…</p> : !signedIn ? <p className="mt-6"><Link href="/login" className="underline">Sign in with the recipient account to read this share.</Link></p> : error ? <p role="alert" className="mt-6 text-red-300">{error} Access may have expired, been revoked, or not been granted to this account.</p> : !share ? <p role="status" className="mt-6">Loading authorized snapshot…</p> : <>
            <p className="mt-5 text-xs">Frozen: {new Date(share.created_at).toLocaleString()} · Expires: {new Date(share.expires_at).toLocaleString()} · Owner: {share.owner_id}</p>
            {share.bundle.theses.map((entry, index) => <article key={`${entry.symbol}:${index}`} className="mt-6 rounded border border-[var(--border-color)] p-5">
                <h2 className="text-xl font-semibold">{entry.symbol} · {entry.thesis.status}</h2>
                {(['thesis', 'catalysts', 'risks', 'invalidation', 'reviewDate'] as const).map((field) => <section key={field} className="mt-4"><h3 className="text-sm font-semibold">{{ thesis: 'Investment Thesis', catalysts: 'Catalysts', risks: 'Risks', invalidation: 'Invalidation conditions', reviewDate: 'Review date' }[field]}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{entry.thesis[field] || 'Not supplied'}</p></section>)}
                {entry.note && <section className="mt-4"><h3 className="text-sm font-semibold">Author note</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{entry.note}</p></section>}
                <h3 className="mt-5 text-sm font-semibold">Linked authored notebook notes</h3>
                {entry.thesis.notebookItemIds?.map((id) => {
                    const item = share.bundle.items.find((candidate) => candidate.id === id);
                    return item ? <section key={id} className="mt-3 border-l-2 border-[var(--border-color)] pl-3"><h4 className="font-medium">{item.title}</h4><p className="text-xs">Captured: {new Date(item.createdAt).toLocaleString()} · Author-entered, no provider originals attached</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{item.body || 'No note text supplied.'}</p></section> : <p key={id} className="mt-2 text-xs">Original note unavailable; no evidence rights granted.</p>;
                })}
                {!entry.thesis.notebookItemIds?.length && <p className="mt-2 text-xs">No original evidence included. Provider citations and originals were excluded from this author-only share.</p>}
            </article>)}
        </>}
    </main>;
}
