import { redirect } from 'next/navigation';

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  redirect(invite ? `/organizador?view=account&invite=${encodeURIComponent(invite)}` : '/acesso');
}