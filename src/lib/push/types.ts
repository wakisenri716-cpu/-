export type PushMessage = { title: string; body: string; url?: string };
export type SendResult = { sent: number; failed: number; invalid: string[]; error?: string };
