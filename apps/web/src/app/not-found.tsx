import Link from 'next/link';
import { VNIBB_BRAND_NAME, VniBBLogo } from '@/components/brand/VniBBLogo';

export default function NotFound() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4 py-8">
            <div className="w-full max-w-md rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 text-center sm:p-8">
                <div className="flex justify-center">
                    <VniBBLogo width={144} label={null} />
                </div>
                <h1 className="mt-6 text-2xl font-bold text-[var(--text-primary)]">Page not found</h1>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                    This address does not match a page in {VNIBB_BRAND_NAME}. Saved workspaces and settings are unaffected.
                </p>
                <Link
                    href="/dashboard"
                    className="mt-6 inline-flex rounded-md bg-[var(--accent-blue)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] focus-visible:ring-offset-2"
                >
                    Return to the workspace
                </Link>
            </div>
        </main>
    );
}
