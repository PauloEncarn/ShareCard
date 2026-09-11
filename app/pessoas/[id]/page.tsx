import Organizer from '../../organizer';
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Organizer initialTab="people" personId={id}/>;
}
