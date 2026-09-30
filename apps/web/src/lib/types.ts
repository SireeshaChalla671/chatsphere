export type User = { id: string; name: string; avatarUrl?: string | null; about?: string; email?: string | null };
export type Receipt = { messageId: string; userId: string; deliveredAt: string | null; readAt: string | null };
export type Message = {
  id: string; chatId: string; senderId: string; body: string | null; createdAt: string;
  deletedForAll: boolean; type?: string; mediaUrl?: string | null; mediaMime?: string | null; mediaName?: string | null; mediaSize?: number | null; sender?: User; receipts?: Receipt[];
};
export type Chat = {
  id: string; type: 'DIRECT' | 'GROUP'; name: string | null; createdAt: string; lastMessageAt: string | null;
  members: { userId: string; user: User }[]; lastMessage: Message | null; unreadCount: number;
};
