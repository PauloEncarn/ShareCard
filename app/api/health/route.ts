export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Safe deployment diagnostic: no secret values are returned. */
export async function GET() {
  const hasUrl = Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasSecret = Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  const hasPublishableKey = Boolean(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

  return Response.json({
    service: 'ShareCard',
    status: hasUrl && hasSecret && hasPublishableKey ? 'ready' : 'configuration_required',
    supabase: { hasUrl, hasPublishableKey, hasSecret },
  }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}