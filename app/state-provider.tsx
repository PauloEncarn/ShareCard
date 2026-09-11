'use client';
import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import { emptyState, type AppState } from '@/lib/model';
import { validateBackup } from '@/lib/storage';
type StateContext = { state: AppState; setState: Dispatch<SetStateAction<AppState>>; ready: boolean; storageError: string; setStorageError: Dispatch<SetStateAction<string>> };
const Context = createContext<StateContext | null>(null);
const accountBackend = process.env.NEXT_PUBLIC_ACCOUNT_BACKEND === 'supabase' ? 'supabase' : 'floci';
const identityEndpoint = accountBackend === 'supabase' ? '/api/supabase/auth/me' : '/api/backend/me';
const workspaceEndpoint = accountBackend === 'supabase' ? '/api/supabase/workspace/workspace' : '/api/backend/workspace';
export function StateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(emptyState), [ready, setReady] = useState(false), [storageError, setStorageError] = useState('');
  const [remote, setRemote] = useState(false), version = useRef(0), hydrated = useRef(false), savedState = useRef('');
  useEffect(() => {
    const load = async () => {
      try {
        const me = await fetch(identityEndpoint, { credentials: 'same-origin' });
        if (me.ok) {
          const account = await me.json() as { role: string };
          if (account.role !== 'master') { hydrated.current = true; setReady(true); return; }
          const response = await fetch(workspaceEndpoint, { credentials: 'same-origin' });
          if (!response.ok) throw new Error('Não foi possível abrir a organização compartilhada.');
          const saved = await response.json() as { state: unknown; version: number };
          if (saved.state) { const restored = validateBackup(saved.state); savedState.current = JSON.stringify(restored); setState(restored); }
          version.current = saved.version; setRemote(true); hydrated.current = true; setReady(true); return;
        }
        const saved = localStorage.getItem('fatura-em-dia:v1'); if (saved) setState(validateBackup(JSON.parse(saved)));
      } catch { setStorageError('Não foi possível carregar a organização. Confira o backend local e tente novamente.'); }
      finally { hydrated.current = true; setReady(true); }
    };
    void load();
  }, []);
  useEffect(() => {
    if (!ready || storageError || !hydrated.current) return;
    if (!remote) {
      try { localStorage.setItem('fatura-em-dia:v1', JSON.stringify(state)); }
      catch { setStorageError('Não foi possível salvar o rascunho local.'); }
      return;
    }
    const serialized = JSON.stringify(state);
    if (serialized === savedState.current) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(workspaceEndpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, version: version.current }) });
        const saved = await response.json();
        if (!response.ok) throw new Error(saved.error || 'Não foi possível salvar a organização.');
        version.current = saved.version; savedState.current = serialized;
      } catch (error) { setStorageError(error instanceof Error ? error.message : 'Não foi possível salvar a organização.'); }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [state, ready, remote, storageError]);
  return <Context.Provider value={{ state, setState, ready, storageError, setStorageError }}>{children}</Context.Provider>;
}
export function useOrganizerState() { const context = useContext(Context); if (!context) throw new Error('StateProvider ausente.'); return context; }
