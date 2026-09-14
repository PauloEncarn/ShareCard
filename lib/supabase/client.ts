import { createClient } from '@supabase/supabase-js';

function requiredUrl() {
  const value = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) throw new Error('Configure SUPABASE_URL no ambiente do servidor.');
  return value;
}

function requiredPublishableKey() {
  const value = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!value) throw new Error('Configure SUPABASE_PUBLISHABLE_KEY no ambiente do servidor.');
  return value;
}

/** Only use this from code that is safe to run in the browser. */
export function createSupabaseBrowserClient() {
  return createClient(requiredUrl(), requiredPublishableKey());
}

/** Server-side client used for normal Supabase Auth operations. */
export function createSupabasePublicClient() {
  return createClient(requiredUrl(), requiredPublishableKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}