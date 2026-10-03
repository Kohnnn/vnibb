import type { Metadata } from 'next';
import { ResearchShareViewer } from '@/components/research/ResearchShareViewer';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
    title: 'Read-only research share',
    robots: { index: false, follow: false },
};

export default async function ResearchSharePage({ params }: { params: Promise<{ shareId: string }> }) {
    const { shareId } = await params;
    return <ResearchShareViewer shareId={shareId} />;
}
