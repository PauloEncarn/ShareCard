import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { accountFromAccessToken } from '@/lib/supabase/identity';

export const dynamic = 'force-dynamic';

export default async function AccessPage() {
  const token = (await cookies()).get('sharecard_session')?.value;
  let authenticated = false;
  if (token) {
    try {
      await accountFromAccessToken(token);
      authenticated = true;
    } catch {
      authenticated = false;
    }
  }
  redirect(authenticated ? '/organizador' : '/organizador?view=account');
}