/** Shared chat message shape for cloud model bridges (DeepSeek, Gemini). */
export interface ChatMessage {
  role: string;
  content: string;
}
