import type { Metadata } from 'next';
import Image from 'next/image';
import { VNIBB_BRAND_DESCRIPTOR, VNIBB_CANONICAL_URL, VNIBB_REPOSITORY_URL } from '@/components/brand/VniBBLogo';

export const metadata: Metadata = {
    title: 'Brand and channels',
    description: 'VniBB wordmark, social card and email signature, with the rules each channel follows.',
    robots: { index: false, follow: false },
};

const EMAIL_SIGNATURE_HTML = `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;max-width:520px;font-family:Inter,Helvetica,Arial,sans-serif;color:#0A0A0A">
  <tr>
    <td style="background:#FFFFFF;padding:5.3px">
      <img src="${VNIBB_CANONICAL_URL}/brand/vnibb-wordmark-master.svg" alt="VniBB" width="96" style="display:block;width:96px;height:auto;border:0" />
    </td>
  </tr>
  <tr>
    <td style="border-top:1px solid #D9DDE3;padding:10px 0 0 0;font-size:13px;line-height:20px">
      <strong style="font-size:14px">Full Name</strong><br />
      <span style="color:#5B6573">Role · ${VNIBB_BRAND_DESCRIPTOR}</span><br />
      <span style="color:#5B6573">Email: replace with an owner-provided address</span><br />
      <a href="${VNIBB_CANONICAL_URL}" style="color:#0B3D91;text-decoration:underline">${VNIBB_CANONICAL_URL.replace('https://', '')}</a>
    </td>
  </tr>
</table>`;

const EMAIL_SIGNATURE_PREVIEW_HTML = EMAIL_SIGNATURE_HTML.replace(
    `${VNIBB_CANONICAL_URL}/brand/`,
    '/brand/',
);

export default function BrandChannelsPage() {
    return (
        <main className="mx-auto max-w-4xl px-4 py-10 text-[var(--text-primary)] sm:px-6">
            <h1 className="text-2xl font-semibold">Brand and channels</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
                Channel artwork uses the supplied wordmark unchanged, without a monogram or invented contact detail.
                In the app, the same SVG is a transparent mask colored by the active theme.
            </p>

            <section className="mt-10">
                <h2 className="text-lg font-semibold">Social / Open Graph card</h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    1200 × 630. Served at <code className="font-mono text-xs">/brand/og-vnibb.png</code> and referenced by the
                    root metadata for <code className="font-mono text-xs">og:image</code> and the Twitter card.
                </p>
                <Image
                    src="/brand/og-vnibb.png"
                    alt="VniBB social card: the wordmark, the descriptor and the site and repository links on a white field"
                    width={1200}
                    height={630}
                    unoptimized
                    className="mt-4 h-auto w-full rounded border border-[var(--border-color)]"
                />
            </section>

            <section className="mt-10">
                <h2 className="text-lg font-semibold">Email signature (live HTML)</h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    The preview loads the bundled wordmark locally. Copied HTML uses its absolute production URL, which
                    requires the wordmark to be deployed there before use. Replace Full Name, Role and the contact
                    address; send as HTML, never as one raster image. The 520 px layout stacks on narrow screens.
                </p>
                <div
                    className="mt-4 overflow-x-auto rounded border border-[var(--border-color)] bg-white p-4"
                    dangerouslySetInnerHTML={{ __html: EMAIL_SIGNATURE_PREVIEW_HTML }}
                />
                <pre className="mt-4 overflow-x-auto rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
                    {EMAIL_SIGNATURE_HTML}
                </pre>
            </section>

            <section className="mt-10 text-sm leading-6 text-[var(--text-secondary)]">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Open items</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>The app uses the wordmark on a white plate for browser and install icons; brand pack v1.1 contains no standalone symbol.</li>
                    <li>The LinkedIn banner in the pack is a 1584 × 528 source composition; adapt it to the destination crop before publishing.</li>
                    <li>No team mailbox, phone number or partnership is claimed; contact details come from the signature owner.</li>
                </ul>
                <p className="mt-4">
                    Site: <a className="text-[var(--accent-blue)] underline" href={VNIBB_CANONICAL_URL}>{VNIBB_CANONICAL_URL}</a>
                    {' · '}Source: <a className="text-[var(--accent-blue)] underline" href={VNIBB_REPOSITORY_URL}>{VNIBB_REPOSITORY_URL}</a>
                </p>
            </section>
        </main>
    );
}
