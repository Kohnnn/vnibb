// Connect Backend Modal - Add new data source endpoint

'use client';

import { useState } from 'react';
import { X, Link as LinkIcon, Loader2, CheckCircle, XCircle } from 'lucide-react';

interface ConnectBackendModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConnect: (endpoint: string, name?: string) => void;
}

export function ConnectBackendModal({ isOpen, onClose, onConnect }: ConnectBackendModalProps) {
    const [endpoint, setEndpoint] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

    if (!isOpen) return null;

    const validateUrl = (url: string): boolean => {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    };

    const handleTestConnection = async () => {
        if (!endpoint.trim()) {
            setError('Please enter an endpoint URL');
            return;
        }

        if (!validateUrl(endpoint)) {
            setError('Please enter a valid URL (e.g., http://localhost:8000/api/v1)');
            return;
        }

        setError('');
        setTesting(true);
        setTestResult(null);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(endpoint, {
                method: 'GET',
                signal: controller.signal,
                mode: 'cors',
            });

            clearTimeout(timeoutId);
            setTestResult(response.ok ? 'success' : 'error');
        } catch {
            setTestResult('error');
        } finally {
            setTesting(false);
        }
    };

    const handleConnect = () => {
        if (!endpoint.trim()) {
            setError('Please enter an endpoint URL');
            return;
        }

        if (!validateUrl(endpoint)) {
            setError('Please enter a valid URL (e.g., http://localhost:8000/api/v1)');
            return;
        }

        setError('');
        onConnect(endpoint.trim(), name.trim() || undefined);

        // Reset form
        setEndpoint('');
        setName('');
        setTestResult(null);
        onClose();
    };

    const handleClose = () => {
        setEndpoint('');
        setName('');
        setError('');
        setTestResult(null);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="bg-[#0f172a] border border-[#334155] rounded-2xl shadow-2xl w-full max-w-md mx-4 animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e293b]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                            <LinkIcon size={20} />
                        </div>
                        <h3 className="text-lg font-semibold text-white">Connect Backend</h3>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-2 text-gray-400 hover:text-white hover:bg-[#1e293b] rounded-lg transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-5">
                    {/* Endpoint URL */}
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-300">
                            API Endpoint <span className="text-red-400">*</span>
                        </label>
                        <input
                            type="url"
                            value={endpoint}
                            onChange={(e) => {
                                setEndpoint(e.target.value);
                                setError('');
                                setTestResult(null);
                            }}
                            placeholder="http://localhost:8000/api/v1"
                            className="w-full bg-[#1e293b] border border-[#334155] text-white px-4 py-3 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-gray-500 transition-all"
                            autoFocus
                        />
                    </div>

                    {/* Name (optional) */}
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-300">
                            Display Name <span className="text-gray-500">(optional)</span>
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="My Backend Server"
                            className="w-full bg-[#1e293b] border border-[#334155] text-white px-4 py-3 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-gray-500 transition-all"
                        />
                        <p className="text-xs text-gray-500">
                            If empty, the hostname will be used as the name
                        </p>
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                            <XCircle size={16} />
                            {error}
                        </div>
                    )}

                    {/* Test Result */}
                    {testResult && (
                        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${testResult === 'success'
                                ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
                            }`}>
                            {testResult === 'success' ? (
                                <>
                                    <CheckCircle size={16} />
                                    Connection successful!
                                </>
                            ) : (
                                <>
                                    <XCircle size={16} />
                                    Connection failed - you can still add this endpoint
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-[#1e293b] bg-[#0b1221]/50 rounded-b-2xl">
                    <button
                        onClick={handleTestConnection}
                        disabled={testing || !endpoint.trim()}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-[#1e293b] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {testing ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                Testing...
                            </>
                        ) : (
                            'Test Connection'
                        )}
                    </button>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleClose}
                            className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-[#1e293b] rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConnect}
                            disabled={!endpoint.trim()}
                            className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Connect
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
