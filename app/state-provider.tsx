'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import { emptyState, type AppState } from '@/lib/model';
import { validateBackup } from '@/lib/storage';

type StateContext = {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
  ready: boolean;
  storageError: string;
  setStorageError: Dispatch<SetStateAction<string>>;
  refreshWorkspace: () => Promise<void>;
};

const Context = createContext<StateContext | null>(null);
const localHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const accountBackend = process.env.NEXT_PUBLIC_ACCOUNT_BACKEND === 'floci' || localHost && !process.env.NEXT_PUBLIC_SUPABASE_URL ? 'floci' : 'supabase';
const identityEndpoint = accountBackend === 'supabase' ? '/api/supabase/auth/me' : '/api/backend/me';
const workspaceEndpoint = accountBackend === 'supabase' ? '/api/supabase/workspace/workspace' : '/api/backend/workspace';

export function StateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(emptyState);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [remote, setRemote] = useState(false);
  const version = useRef(0);
  const hydrated = useRef(false);
  const savedState = useRef('');

  const applyWorkspace = useCallback((payload: { state: unknown; version: number }) => {
    const restored = payload.state ? validateBackup(payload.state) : emptyState;
    version.current = payload.version;
    savedState.current = JSON.stringify(restored);
    setState(restored);
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (!remote) {
      setStorageError('');
      return;
    }

    const response = await fetch(workspaceEndpoint, { credentials: 'same-origin' });
    const payload = await response.json().catch(() => null) as { state?: unknown; version?: number; error?: string } | null;
    if (!response.ok || !payload || typeof payload.version !== 'number') {
      throw new Error(payload?.error || 'Não foi possível atualizar a organização.');
    }

    applyWorkspace({ state: payload.state, version: payload.version });
    setStorageError('');
  }, [applyWorkspace, remote]);

  useEffect(() => {
    const load = async () => {
      try {
        const me = await fetch(identityEndpoint, { credentials: 'same-origin' });
        if (me.ok) {
          const account = await me.json() as { role: string };
          if (account.role !== 'master') {
            hydrated.current = true;
            setReady(true);
            return;
          }

          const response = await fetch(workspaceEndpoint, { credentials: 'same-origin' });
          const saved = await response.json().catch(() => null) as { state?: unknown; version?: number; error?: string } | null;
          if (!response.ok || !saved || typeof saved.version !== 'number') {
            throw new Error(saved?.error || 'Não foi possível abrir a organização compartilhada.');
          }

          applyWorkspace({ state: saved.state, version: saved.version });
          setRemote(true);
          hydrated.current = true;
          setReady(true);
          return;
        }

        const saved = localStorage.getItem('fatura-em-dia:v1');
        if (saved) setState(validateBackup(JSON.parse(saved)));
      } catch {
        setStorageError('Não foi possível carregar a organização. Atualize a página e tente novamente.');
      } finally {
        hydrated.current = true;
        setReady(true);
      }
    };
    void load();
  }, [applyWorkspace]);

  useEffect(() => {
    const applyRemoteState = (event: Event) => {
      const detail = (event as CustomEvent<{ state?: unknown; version?: unknown }>).detail;
      if (!detail || typeof detail.version !== 'number' || !Number.isInteger(detail.version) || detail.version < 1) return;
      try {
        applyWorkspace({ state: detail.state, version: detail.version });
        setStorageError('');
      } catch {
        setStorageError('Não foi possível atualizar a organização após excluir a fatura. Atualize a página.');
      }
    };

    window.addEventListener('sharecard:workspace-replaced', applyRemoteState);
    return () => window.removeEventListener('sharecard:workspace-replaced', applyRemoteState);
  }, [applyWorkspace]);

  useEffect(() => {
    if (!ready || storageError || !hydrated.current) return;

    if (!remote) {
      try {
        localStorage.setItem('fatura-em-dia:v1', JSON.stringify(state));
      } catch {
        setStorageError('Não foi possível salvar o rascunho local.');
      }
      return;
    }

    const serialized = JSON.stringify(state);
    if (serialized === savedState.current) return;

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(workspaceEndpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state, version: version.current }),
        });
        const saved = await response.json().catch(() => null) as { version?: number; error?: string } | null;
        if (!response.ok) {
          if (response.status === 409) {
            try {
              await refreshWorkspace();
              setStorageError('Outra pessoa alterou a organização. A versão mais recente foi carregada; revise a alteração antes de continuar.');
            } catch {
              setStorageError('Outra pessoa alterou a organização. Atualize a página para carregar a versão mais recente.');
            }
            return;
          }
          throw new Error(saved?.error || 'Não foi possível salvar a organização.');
        }

        if (typeof saved?.version !== 'number') throw new Error('Não foi possível confirmar o salvamento.');
        version.current = saved.version;
        savedState.current = serialized;
      } catch (error) {
        setStorageError(error instanceof Error ? error.message : 'Não foi possível salvar a organização.');
      }
    }, 650);

    return () => window.clearTimeout(timer);
  }, [state, ready, remote, storageError, refreshWorkspace]);

  return <Context.Provider value={{ state, setState, ready, storageError, setStorageError, refreshWorkspace }}>{children}</Context.Provider>;
}

export function useOrganizerState() {
  const context = useContext(Context);
  if (!context) throw new Error('StateProvider ausente.');
  return context;
}
