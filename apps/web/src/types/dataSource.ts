// TypeScript types for data sources / backend connections

import { generateId } from './dashboard';

// ============================================================================
// Data Source Types
// ============================================================================

export type DataSourceStatus = 'connected' | 'disconnected' | 'error' | 'checking';

export interface DataSource {
    id: string;
    name: string;
    endpoint: string;
    status: DataSourceStatus;
    lastChecked?: string;
    errorMessage?: string;
    createdAt: string;
}

// ============================================================================
// State Types
// ============================================================================

export interface DataSourceState {
    dataSources: DataSource[];
    vnstockSource: 'KBS' | 'VCI' | 'TCBS' | 'DNSE';
}


// ============================================================================
// CRUD Types
// ============================================================================

export interface DataSourceCreate {
    name?: string;
    endpoint: string;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createDataSource(data: DataSourceCreate): DataSource {
    // Extract hostname for default name if not provided
    let defaultName = 'Custom Backend';
    try {
        const url = new URL(data.endpoint);
        defaultName = url.hostname;
    } catch {
        // Keep default name if URL parsing fails
    }

    return {
        id: generateId(),
        name: data.name || defaultName,
        endpoint: data.endpoint,
        status: 'disconnected',
        createdAt: new Date().toISOString(),
    };
}
