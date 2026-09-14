import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import CloudWorkspace from '../conta/workspace';
import { accountFromAccessToken } from '@/lib/supabase/identity';

export const dynamic = 'force-dynamic';

export default async function AccessPage() {
  const token = (await cookies()).get('sharecard_session')?.value;
  if (token) {
    try {
      await accountFromAccessToken(token);
      redirect('/organizador');
    } catch {
      // A tela de acesso oferece uma nova sessão quando o cookie expirou.
    }
  }
  return <CloudWorkspace />;
}