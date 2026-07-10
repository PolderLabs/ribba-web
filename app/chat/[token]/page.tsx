import ChatGateway from '@/components/chat/ChatGateway';

export default async function ChatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ChatGateway token={token} />;
}
