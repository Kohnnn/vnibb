import { act, render, screen, waitFor } from '@testing-library/react';
import type { Session, Subscription } from '@supabase/supabase-js';
import { AuthProvider, useAuth } from './AuthContext';
import { getAdminSession } from '@/lib/api';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/api', () => ({ getDashboardClientId: jest.fn(() => null), getAdminSession: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ identifyAnalyticsUser: jest.fn(), resetAnalytics: jest.fn() }));
jest.mock('@/lib/supabase', () => ({
    isSupabaseConfigured: true,
    supabase: { auth: { getSession: jest.fn(), onAuthStateChange: jest.fn() } },
}));

let authChanged: (event: string, session: Session | null) => void;
const account = { id: 'user-1', email: 'admin@example.test', user_metadata: { role: 'admin' } };
const sessionFor = (token: string) => ({ access_token: token, user: account } as unknown as Session);

function AdminState() {
    const { isAdmin, adminStatus, adminError } = useAuth();
    return <div>{isAdmin ? 'authorized' : adminStatus}{adminError && <span>{adminError}</span>}</div>;
}

beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({ data: { session: sessionFor('token-one') }, error: null });
    jest.mocked(supabase!.auth.onAuthStateChange).mockImplementation((callback) => {
        authChanged = callback as typeof authChanged;
        return { data: { subscription: { unsubscribe: jest.fn() } as unknown as Subscription } };
    });
});

afterEach(() => localStorage.clear());

test('a metadata admin remains denied when the server rejects the session and legacy keys are erased', async () => {
    localStorage.setItem('vnibb_admin_layout_key', 'legacy-secret');
    localStorage.setItem('vnibb_admin_layout_key_validated', '1');
    jest.mocked(getAdminSession).mockRejectedValue(new Error('Forbidden'));
    render(<AuthProvider><AdminState /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('denied')).toBeInTheDocument());
    expect(screen.getByText('Forbidden')).toBeInTheDocument();
    expect(localStorage.getItem('vnibb_admin_layout_key')).toBeNull();
    expect(localStorage.getItem('vnibb_admin_layout_key_validated')).toBeNull();
});

test('a token rotation removes authority until the new token is verified and logout revokes it', async () => {
    const secondCheck = Promise.withResolvers<{ id: string; role: 'admin' }>();
    jest.mocked(getAdminSession)
        .mockResolvedValueOnce({ id: account.id, role: 'admin' })
        .mockImplementationOnce(() => secondCheck.promise);
    render(<AuthProvider><AdminState /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('authorized')).toBeInTheDocument());
    act(() => authChanged('TOKEN_REFRESHED', sessionFor('token-two')));
    expect(screen.getByText('checking')).toBeInTheDocument();
    await act(async () => secondCheck.resolve({ id: account.id, role: 'admin' }));
    expect(screen.getByText('authorized')).toBeInTheDocument();
    act(() => authChanged('SIGNED_OUT', null));
    expect(screen.getByText('signed-out')).toBeInTheDocument();
});

test('a denied admin API response revokes previously verified access for that bearer', async () => {
    jest.mocked(getAdminSession).mockResolvedValue({ id: account.id, role: 'admin' });
    render(<AuthProvider><AdminState /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('authorized')).toBeInTheDocument());
    act(() => window.dispatchEvent(new CustomEvent('vnibb:admin-access-denied', { detail: 'Bearer token-one' })));
    expect(screen.getByText('denied')).toBeInTheDocument();
});
