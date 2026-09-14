import { redirect } from 'next/navigation';
import Organizer from '../organizer';

const legacyRoutes: Record<string, string> = {
  overview: '/organizador',
  transactions: '/organizador/lancamentos',
  forecast: '/organizador/previsoes',
  cards: '/cartoes',
  account: '/perfil',
};

export default async function OrganizerPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  if (view && legacyRoutes[view]) redirect(legacyRoutes[view]);
  return <Organizer initialTab="overview"/>;
}