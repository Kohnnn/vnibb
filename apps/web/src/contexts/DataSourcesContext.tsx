// Data Sources Context - Manage backend API connections

'use client';

import {
    createContext,
    useContext,
    useReducer,
    useCallback,
    useEffect,
    type ReactNode,
} from 'react';
import type { DataSource, DataSourceState, DataSourceCreate } from '@/types/dataSource';
import { createDataSource } from '@/types/dataSource';

const STORAGE_KEY = 'vnibb_data_sources';
const VNSTOCK_SOURCE_KEY = 'vnibb_vnstock_source';

export type VnstockSource = 'KBS' | 'VCI' | 'TCBS' | 'DNSE';

// ============================================================================
// Actions
// ============================================================================

type DataSourceAction =
    | { type: 'SET_STATE'; payload: DataSourceState }
    | { type: 'ADD_DATA_SOURCE'; payload: DataSource }
    | { type: 'REMOVE_DATA_SOURCE'; payload: string }
    | { type: 'UPDATE_STATUS'; payload: { id: string; status: DataSource['status']; errorMessage?: string } }
    | { type: 'SET_LAST_CHECKED'; payload: { id: string; lastChecked: string } }
    | { type: 'SET_VNSTOCK_SOURCE'; payload: VnstockSource };

// ============================================================================
// Reducer
// ============================================================================

function dataSourceReducer(state: DataSourceState, action: DataSourceAction): DataSourceState {
    switch (action.type) {
        case 'SET_STATE':
            return action.payload;

        case 'ADD_DATA_SOURCE':
            return {
                ...state,
                dataSources: [...state.dataSources, action.payload],
            };

        case 'REMOVE_DATA_SOURCE':
            return {
                ...state,
                dataSources: state.dataSources.filter(ds => ds.id !== action.payload),
            };

        case 'UPDATE_STATUS':
            return {
                ...state,
                dataSources: state.dataSources.map(ds =>
                    ds.id === action.payload.id
                        ? { ...ds, status: action.payload.status, errorMessage: action.payload.errorMessage }
                        : ds
                ),
            };

        case 'SET_LAST_CHECKED':
            return {
                ...state,
                dataSources: state.dataSources.map(ds =>
                    ds.id === action.payload.id
                        ? { ...ds, lastChecked: action.payload.lastChecked }
                        : ds
                ),
            };

        case 'SET_VNSTOCK_SOURCE':
            return {
                ...state,
                vnstockSource: action.payload
            };

        default:
            return state;
    }
}


// ============================================================================
// Context
// ============================================================================

interface DataSourcesContextValue {
    state: DataSourceState;
    dataSources: DataSource[];
    preferredVnstockSource: VnstockSource;
    setPreferredVnstockSource: (source: VnstockSource) => void;
    addDataSource: (data: DataSourceCreate) => DataSource;
    removeDataSource: (id: string) => void;
    checkConnection: (id: string) => Promise<boolean>;
    checkAllConnections: () => Promise<void>;
}

const DataSourcesContext = createContext<DataSourcesContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface DataSourcesProviderProps {
    children: ReactNode;
}

const initialState: DataSourceState = {
    dataSources: [],
    vnstockSource: 'KBS',
};

export function DataSourcesProvider({ children }: DataSourcesProviderProps) {
    const [state, dispatch] = useReducer(dataSourceReducer, initialState);

    // Load from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved) as Partial<DataSourceState>;
                dispatch({ type: 'SET_STATE', payload: { ...initialState, ...parsed, vnstockSource: state.vnstockSource } });
            }
            const savedVnstockSource = localStorage.getItem(VNSTOCK_SOURCE_KEY) as VnstockSource | null;
            if (savedVnstockSource && ['KBS', 'VCI', 'TCBS', 'DNSE'].includes(savedVnstockSource)) {
                dispatch({ type: 'SET_VNSTOCK_SOURCE', payload: savedVnstockSource });
            }
        } catch (error) {
            console.error('Failed to load data sources from localStorage:', error);
        }
    }, []);



    // Persist to localStorage on state change
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ dataSources: state.dataSources }));
            localStorage.setItem(VNSTOCK_SOURCE_KEY, state.vnstockSource);
        } catch (error) {
            console.error('Failed to save data sources to localStorage:', error);
        }
    }, [state]);

    // Add a new data source
    const addDataSource = useCallback((data: DataSourceCreate): DataSource => {
        const newSource = createDataSource(data);
        dispatch({ type: 'ADD_DATA_SOURCE', payload: newSource });
        return newSource;
    }, []);

    // Set preferred vnstock source
    const setPreferredVnstockSource = useCallback((source: VnstockSource) => {
        dispatch({ type: 'SET_VNSTOCK_SOURCE', payload: source });
    }, []);

    // Remove a data source
    const removeDataSource = useCallback((id: string) => {
        dispatch({ type: 'REMOVE_DATA_SOURCE', payload: id });
    }, []);

    // Check connection for a single data source
    const checkConnection = useCallback(async (id: string): Promise<boolean> => {
        const source = state.dataSources.find(ds => ds.id === id);
        if (!source) return false;

        dispatch({ type: 'UPDATE_STATUS', payload: { id, status: 'checking' } });

        try {
            // Try to fetch the endpoint with a timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(source.endpoint, {
                method: 'GET',
                signal: controller.signal,
                mode: 'cors',
            });

            clearTimeout(timeoutId);

            const now = new Date().toISOString();
            dispatch({ type: 'SET_LAST_CHECKED', payload: { id, lastChecked: now } });

            if (response.ok) {
                dispatch({ type: 'UPDATE_STATUS', payload: { id, status: 'connected' } });
                return true;
            } else {
                dispatch({
                    type: 'UPDATE_STATUS',
                    payload: { id, status: 'error', errorMessage: `HTTP ${response.status}` },
                });
                return false;
            }
        } catch (error) {
            const now = new Date().toISOString();
            dispatch({ type: 'SET_LAST_CHECKED', payload: { id, lastChecked: now } });

            const errorMessage = error instanceof Error ? error.message : 'Connection failed';
            dispatch({
                type: 'UPDATE_STATUS',
                payload: { id, status: 'error', errorMessage },
            });
            return false;
        }
    }, [state.dataSources]);

    // Check all connections
    const checkAllConnections = useCallback(async () => {
        await Promise.all(state.dataSources.map(ds => checkConnection(ds.id)));
    }, [state.dataSources, checkConnection]);

    const value: DataSourcesContextValue = {
        state,
        dataSources: state.dataSources,
        preferredVnstockSource: state.vnstockSource,
        setPreferredVnstockSource,
        addDataSource,
        removeDataSource,
        checkConnection,
        checkAllConnections,
    };

    return (
        <DataSourcesContext.Provider value={value}>
            {children}
        </DataSourcesContext.Provider>
    );
}

// ============================================================================
// Hook
// ============================================================================

export function useDataSources() {
    const context = useContext(DataSourcesContext);
    if (!context) {
        throw new Error('useDataSources must be used within a DataSourcesProvider');
    }
    return context;
}
