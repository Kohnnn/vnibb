// Copilot API endpoints

import { fetchAPI } from '../client';
import type { AISettings } from '@/lib/aiSettings';

export interface CopilotQuery {
    query: string;
    context?: {
        symbol?: string;
        dashboard?: string;
        widgets?: string[];
    };
    settings?: CopilotTransportSettings;
}

export interface CopilotTransportSettings {
    mode?: 'app_default' | 'openrouter' | 'custom';
    provider?: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    webSearch?: boolean;
    preferAppwriteData?: boolean;
    enableSidebarWorkflowOutputs?: boolean;
}

export interface CopilotStreamRequest {
    query: string;
    context?: {
        symbol?: string;
        dashboard?: string;
        widgets?: string[];
    };
    settings?: CopilotTransportSettings;
}

export interface CopilotDocumentContext {
    id: string;
    name: string;
    content: string;
    type: string;
    uploaded_at: string;
}

export interface CopilotRuntimeConfig {
    mode: 'app_default' | 'openrouter' | 'custom';
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    webSearch?: boolean;
}

export interface ModelOption {
    id: string;
    name: string;
    provider: string;
    description?: string;
}

export interface PromptTemplate {
    id: string;
    name: string;
    prompt: string;
    description?: string;
}

export async function askCopilot(query: CopilotQuery): Promise<unknown> {
    return fetchAPI<unknown>('/copilot/chat', {
        method: 'POST',
        body: JSON.stringify(query),
    });
}

export async function submitCopilotFeedback(
    conversationId: string,
    feedback: {
        rating: number;
        comment?: string;
    }
): Promise<void> {
    return fetchAPI<void>(`/copilot/feedback/${conversationId}`, {
        method: 'POST',
        body: JSON.stringify(feedback),
    });
}

export async function submitCopilotOutcome(
    conversationId: string,
    outcome: {
        helpful: boolean;
        outcome?: string;
    }
): Promise<void> {
    return fetchAPI<void>(`/copilot/outcome/${conversationId}`, {
        method: 'POST',
        body: JSON.stringify(outcome),
    });
}

export async function getAdminAITelemetry(): Promise<unknown> {
    return fetchAPI<unknown>('/admin/ai/telemetry');
}

export async function getAdminAIPromptLibrary(): Promise<unknown> {
    return fetchAPI<unknown>('/admin/ai/prompts');
}

export async function saveAdminAIPromptLibrary(prompts: unknown): Promise<void> {
    return fetchAPI<void>('/admin/ai/prompts', {
        method: 'PUT',
        body: JSON.stringify(prompts),
    });
}

export async function getAdminAIRuntimeConfig(): Promise<CopilotRuntimeConfig> {
    return fetchAPI<CopilotRuntimeConfig>('/admin/ai/runtime-config');
}

export async function getPublicUnitRuntimeConfig(): Promise<{ unit: string; value: unknown }> {
    return fetchAPI<{ unit: string; value: unknown }>('/copilot/unit-runtime-config');
}

export async function getAdminUnitRuntimeConfig(unit: string): Promise<unknown> {
    return fetchAPI<unknown>(`/admin/unit-runtime-config/${unit}`);
}

export async function getAdminProviderStatus(): Promise<unknown> {
    return fetchAPI<unknown>('/admin/ai/provider-status');
}

export async function getCopilotModelCatalog(provider: 'openrouter' = 'openrouter'): Promise<{ models: ModelOption[] }> {
    return fetchAPI<{ models: ModelOption[] }>(`/copilot/models/${provider}`);
}

export async function getCopilotRuntimeConfig(): Promise<CopilotRuntimeConfig> {
    return fetchAPI<CopilotRuntimeConfig>('/copilot/runtime-config');
}

export async function createCopilotDocumentContext(file: File): Promise<{ document: CopilotDocumentContext }> {
    const formData = new FormData();
    formData.append('file', file);

    return fetchAPI<{ document: CopilotDocumentContext }>('/copilot/documents', {
        method: 'POST',
        body: formData,
    });
}

export async function saveAdminAIRuntimeConfig(config: CopilotRuntimeConfig): Promise<void> {
    return fetchAPI<void>('/admin/ai/runtime-config', {
        method: 'PUT',
        body: JSON.stringify(config),
    });
}

export async function saveAdminUnitRuntimeConfig(unit: string, value: unknown): Promise<void> {
    return fetchAPI<void>(`/admin/unit-runtime-config/${unit}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
    });
}

export async function openCopilotChatStream(request: CopilotStreamRequest): Promise<ReadableStream> {
    const response = await fetch(`/api/v1/copilot/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });

    if (!response.ok) {
        throw new Error(`Copilot stream failed: ${response.status}`);
    }

    return response.body as ReadableStream;
}

export async function consumeCopilotStream(
    stream: ReadableStream,
    onChunk: (data: unknown) => void,
    onComplete?: () => void,
    onError?: (error: Error) => void
): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });
            const lines = text.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = JSON.parse(line.slice(6));
                    onChunk(data);
                }
            }
        }
        onComplete?.();
    } catch (error) {
        onError?.(error as Error);
    }
}

export async function getCopilotSuggestions(): Promise<{ suggestions: string[] }> {
    return fetchAPI<{ suggestions: string[] }>('/copilot/suggestions');
}

export async function getCopilotPrompts(): Promise<{ prompts: PromptTemplate[] }> {
    return fetchAPI<{ prompts: PromptTemplate[] }>('/copilot/prompts');
}
