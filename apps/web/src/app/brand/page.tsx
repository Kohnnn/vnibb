import type { Metadata } from 'next';
import Image from 'next/image';
import { VNIBB_BRAND_DESCRIPTOR, VNIBB_CANONICAL_URL, VNIBB_REPOSITORY_URL } from '@/components/brand/VniBBLogo';

export const metadata: Metadata = {
    title: 'Brand and channels',
    description: 'VniBB wordmark, social card and email signature, with the rules each channel follows.',
    robots: { index: false, follow: false },
};

const EMAIL_SIGNATURE_HTML = `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Inter,Helvetica,Arial,sans-serif;color:#0A0A0A;max-width:520px">
  <tr>
    <td style="padding:0 0 10px 0">
      <img src="${VNIBB_CANONICAL_URL}/brand/vnibb-wordmark-master.svg" alt="VniBB" width="140" style="display:block;width:140px;height:auto;border:0" />
    </td>
  </tr>
  <tr>
    <td style="border-top:1px solid #D8DCE2;padding:10px 0 0 0;font-size:13px;line-height:20px">
      <strong style="font-size:14px">Full Name</strong><br />
      <span style="color:#4A5568">Role · ${VNIBB_BRAND_DESCRIPTOR}</span><br />
      <a href="mailto:name@example.com" style="color:#1F4FD8;text-decoration:none">name@example.com</a>
      <span style="color:#4A5568"> · </span>
      <a href="${VNIBB_CANONICAL_URL}" style="color:#1F4FD8;text-decoration:none">${VNIBB_CANONICAL_URL.replace('https://', '')}</a>
    </td>
  </tr>
</table>`;

export default function BrandChannelsPage() {
    return (
        <main className="mx-auto max-w-4xl px-4 py-10 text-[var(--text-primary)] sm:px-6">
            <h1 className="text-2xl font-semibold">Brand and channels</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
                Channel artwork derived from the supplied brand pack. The wordmark is used unchanged; no monogram,
                recolor or invented contact detail appears in any of these assets.
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
                    Small wordmark image plus live text, 480–560 px wide. Replace Full Name, Role and the contact address
                    before use; send it as HTML, never as one raster image.
                </p>
                <div
                    className="mt-4 overflow-x-auto rounded border border-[var(--border-color)] bg-white p-4"
                    dangerouslySetInnerHTML={{ __html: EMAIL_SIGNATURE_HTML }}
                />
                <pre className="mt-4 overflow-x-auto rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
                    {EMAIL_SIGNATURE_HTML}
                </pre>
            </section>

            <section className="mt-10 text-sm leading-6 text-[var(--text-secondary)]">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Open items</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>Favicon and app-icon artwork is not in brand pack v1.1; manifest icon entries stay unresolved until that artwork is approved.</li>
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
