/**
 * @jest-environment jsdom
 */
import { TextDecoder, TextEncoder } from 'util';

import { consumeCopilotStream } from '@/lib/api';

// jsdom ships neither global; api.ts decodes the SSE stream with TextDecoder.
globalThis.TextDecoder = TextDecoder as unknown as typeof globalThis.TextDecoder;
globalThis.TextEncoder = TextEncoder as unknown as typeof globalThis.TextEncoder;

function sseResponse(frames: Array<Record<string, unknown>>): Response {
    const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('');
    const bytes = new Uint8Array(body.length);
    for (let index = 0; index < body.length; index += 1) {
        bytes[index] = body.charCodeAt(index) & 0xff;
    }
    let sent = false;
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: {
            getReader: () => ({
                read: async () =>
                    sent ? { value: undefined, done: true } : ((sent = true), { value: bytes, done: false }),
            }),
        },
    } as unknown as Response;
}

describe('copilot stream follow-up normalizer', () => {
    it('carries camelCase followUps from the done frame into onDone', async () => {
        let done: Record<string, unknown> | undefined;
        await consumeCopilotStream(
            sseResponse([
                { chunk: 'Answer.' },
                {
                    done: true,
                    followUps: [
                        { id: 'peer_comparison', label: 'Compare against peers', prompt: 'Compare VNM against peers.', sourceIds: ['VNM-RATIOS'] },
                    ],
                },
            ]),
            { onDone: (event) => { done = event as unknown as Record<string, unknown>; } },
        );

        expect(done?.followUps).toEqual([
            { id: 'peer_comparison', label: 'Compare against peers', prompt: 'Compare VNM against peers.', sourceIds: ['VNM-RATIOS'] },
        ]);
    });

    it('accepts the snake_case follow_ups alias', async () => {
        let done: Record<string, unknown> | undefined;
        await consumeCopilotStream(
            sseResponse([
                {
                    done: true,
                    follow_ups: [{ id: 'market_breadth_read', label: 'Read the market breadth', prompt: 'Is breadth supportive?', source_ids: ['MKT-SECTORS'] }],
                },
            ]),
            { onDone: (event) => { done = event as unknown as Record<string, unknown>; } },
        );

        expect(done?.followUps).toEqual([
            { id: 'market_breadth_read', label: 'Read the market breadth', prompt: 'Is breadth supportive?', sourceIds: ['MKT-SECTORS'] },
        ]);
    });

    it('drops incomplete follow-ups instead of rendering empty buttons', async () => {
        let done: Record<string, unknown> | undefined;
        await consumeCopilotStream(
            sseResponse([
                {
                    done: true,
                    followUps: [
                        { id: 'ok', label: 'Keep me', prompt: 'Keep me?' },
                        { id: 'no_prompt', label: 'Missing prompt' },
                        { label: 'Missing id', prompt: 'Missing id?' },
                    ],
                },
            ]),
            { onDone: (event) => { done = event as unknown as Record<string, unknown>; } },
        );

        expect(done?.followUps).toEqual([{ id: 'ok', label: 'Keep me', prompt: 'Keep me?' }]);
    });
});
