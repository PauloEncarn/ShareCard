import { redirect } from 'next/navigation';

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  redirect(invite ? `/acesso?invite=${encodeURIComponent(invite)}` : '/acesso');
}