'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import type { ResearchBundle } from '@/lib/researchBundle';
import { createResearchShare, listResearchShares, previewAuthorResearch, revokeResearchShare, type AuthorResearchPreview, type ResearchShareSummary } from '@/lib/researchSharing';

export function ResearchShareControls({ buildBundle }: { buildBundle: () => ResearchBundle }) {
    const { user, loading } = useAuth();
    const [shares, setShares] = useState<ResearchShareSummary[]>([]);
    const [recipients, setRecipients] = useState('');
    const [days, setDays] = useState(7);
    const [preview, setPreview] = useState<AuthorResearchPreview | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const signedIn = user?.provider === 'supabase';
    const requestGeneration = useRef(0);

    useEffect(() => {
        let active = true;
        requestGeneration.current += 1;
        setShares([]);
        setPreview(null);
        setConfirmed(false);
        setRecipients('');
        setError('');
        setBusy(false);
        if (signedIn) void listResearchShares().then((result) => { if (active) setShares(result); }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Share history unavailable.'); });
        return () => { active = false; requestGeneration.current += 1; };
    }, [signedIn, user?.id]);

    async function create() {
        if (!signedIn || !preview || !confirmed) return;
        const generation = requestGeneration.current;
        setBusy(true);
        setError('');
        try {
            const recipientIds = recipients.split(/[\s,]+/).filter(Boolean);
            if (!recipientIds.length || recipientIds.length > 20 || recipientIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) throw new Error('Enter 1–20 recipient account UUIDs.');
            const share = await createResearchShare(preview.bundle, recipientIds, new Date(Date.now() + days * 86400000).toISOString());
            if (generation !== requestGeneration.current) return;
            setShares((current) => [share, ...current]);
            setPreview(null);
            setConfirmed(false);
        } catch (cause) { if (generation === requestGeneration.current) setError(cause instanceof Error ? cause.message : 'Could not create share.'); }
        finally { if (generation === requestGeneration.current) setBusy(false); }
    }

    async function revoke(id: string) {
        if (!signedIn) return;
        const generation = requestGeneration.current;
        setBusy(true);
        setError('');
        try {
            await revokeResearchShare(id);
            if (generation !== requestGeneration.current) return;
            setShares((current) => current.map((share) => share.share_id === id ? { ...share, revoked_at: new Date().toISOString() } : share));
        } catch (cause) { if (generation === requestGeneration.current) setError(cause instanceof Error ? cause.message : 'Could not revoke share.'); }
        finally { if (generation === requestGeneration.current) setBusy(false); }
    }

    return <section aria-labelledby="research-sharing-title" className="mt-5 border-t border-[var(--border-color)] pt-3 text-xs">
        <h3 id="research-sharing-title" className="text-sm font-semibold">Share a frozen, read-only thesis</h3>
        <p className="mt-2 leading-5">Only named signed-in recipients can read. No public access, editing or import. Owner consent persists after sign-out until expiry or revocation. URLs do not grant source rights.</p>
        {!signedIn ? <p className="mt-2">{loading ? 'Checking sign-in…' : <Link href="/login" className="underline">Sign in with your account to manage shares.</Link>}</p> : <>
            <p className="mt-2 break-all">Your account UUID: <code>{user.id}</code>. Ask recipients for their UUID; no account directory is exposed.</p>
            <label className="mt-3 block">Recipient account UUIDs (comma or space separated, max 20)<textarea value={recipients} onChange={(event) => setRecipients(event.target.value)} rows={2} className="mt-1 w-full rounded border border-[var(--border-color)] bg-[var(--bg-primary)] p-2" /></label>
            <label className="mt-2 block">Expires in <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="ml-2 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">{[1, 7, 14, 30].map((day) => <option key={day} value={day}>{day} days</option>)}</select></label>
            <button type="button" disabled={busy} onClick={() => { setError(''); setConfirmed(false); try { setPreview(previewAuthorResearch(buildBundle())); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Select theses first.'); } }} className="mt-3 min-h-11 rounded border border-blue-500 px-3 focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-40">Preview author-only snapshot</button>
            {preview && <div className="mt-3 rounded border border-amber-500/50 p-3">
                <p>{preview.bundle.theses.length} theses and {preview.bundle.items.length} authored notebook notes. Excluded: {preview.excludedOriginals} provider/widget/agent originals and {preview.excludedCitations} citations.</p>
                <p className="mt-2 leading-5 text-amber-300">Provider originals are denied: browser provenance is not authoritative and no source rights are granted. The author-only classification is not a legal grant or proof of content origin. Review all text; do not share copied provider content, secrets, HTML or model instructions.</p>
                <details className="mt-2"><summary className="cursor-pointer">Review exact frozen text</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(preview.bundle, null, 2)}</pre></details>
                <label className="mt-3 flex gap-2"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed this snapshot and have permission to share this authored text.</label>
                <button type="button" disabled={!confirmed || busy} onClick={() => void create()} className="mt-3 min-h-11 rounded border border-emerald-500 px-3 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-40">Create recipient-only share</button>
            </div>}
            <h4 className="mt-4 font-semibold">Your shares ({shares.length}/100)</h4>
            {!shares.length && <p className="mt-2">No shares created.</p>}
            <ul className="mt-2 space-y-3">{shares.map((share) => <li key={share.share_id} className="rounded border border-[var(--border-color)] p-3">
                <p>{share.thesis_count} theses · {share.evidence_count} authored notes · {share.revoked_at ? 'Revoked' : Date.parse(share.expires_at) <= Date.now() ? 'Expired' : 'Active'}</p>
                <p className="mt-1">Expires: {new Date(share.expires_at).toLocaleString()}</p><p className="mt-1 break-all">Recipients: {share.recipient_ids.join(', ')}</p>
                <Link href={`/research-shares/${share.share_id}`} className="mt-2 block break-all underline">/research-shares/{share.share_id}</Link>
                <p className="mt-1">Send this path to the named recipients; they must sign in.</p>
                {!share.revoked_at && <button type="button" disabled={busy} onClick={() => void revoke(share.share_id)} className="mt-2 min-h-11 rounded border border-red-400 px-3 focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-40">Revoke access</button>}
            </li>)}</ul>
        </>}
        {error && <p role="alert" className="mt-3 text-red-300">{error}</p>}
    </section>;
}
