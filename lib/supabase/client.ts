import { createClient } from '@supabase/supabase-js';

function required(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') {
  const value = process.env[name];
  if (!value) throw new Error(`Configure ${name} para usar o Supabase.`);
  return value;
}

/** Client safe for browser components: it only uses the publishable key. */
export function createSupabaseBrowserClient() {
  return createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  );
}

/** Server-side client that uses the public key for normal Auth operations. */
export function createSupabasePublicClient() {
  return createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
