import { createClient } from '@supabase/supabase-js';

/** Server-only client. Never import it from a component with 'use client'. */
export function createSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  // SUPABASE_SECRET_KEY is the current Supabase server key. The legacy name
  // remains only as a temporary fallback for local development.
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) throw new Error('Configure a URL e a chave secreta do Supabase no ambiente do servidor.');
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}