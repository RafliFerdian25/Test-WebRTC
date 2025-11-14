import VideoCall from '@/components/VideoCall';

interface PageProps {
  params: Promise<{ roomId: string }>;
}

export default async function Page({ params }: PageProps) {
  const { roomId } = await params;
  
  return <VideoCall roomId={roomId} />;
}
