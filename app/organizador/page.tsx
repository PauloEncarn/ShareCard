import Organizer from '../organizer';
export default async function OrganizerPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) { const { view } = await searchParams; return <Organizer key={view ?? 'overview'} initialTab={['overview', 'transactions', 'forecast', 'cards', 'account'].includes(view ?? '') ? view : 'overview'}/>; }
