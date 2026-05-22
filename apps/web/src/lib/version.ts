/**
 * Single source of truth for the user-facing release version.
 *
 * Changing this value:
 *   1. Updates the sidebar label in `Sidebar.tsx`.
 *   2. Re-arms the WhatsNewPanel for every user (the storage key is keyed
 *      on the version string).
 *   3. Should be done together with a corresponding entry in
 *      `vnibb/CHANGELOG.md`.
 */
export const CURRENT_RELEASE = 'v1.4.0';
export const CURRENT_RELEASE_DATE = '2026-05-22';

/**
 * Window event name dispatched when the user wants to manually re-open the
 * WhatsNew panel (clicking the sidebar version label or the Settings
 * "Show release notes" button). The panel listens for this and clears its
 * acknowledged flag in localStorage before re-opening.
 */
export const WHATS_NEW_REOPEN_EVENT = 'vnibb:whats-new:reopen';
