/** LLM 统一返回结构（多轮 chat / 单轮 generateContent / 无状态 chatMessages 共用） */
export interface GenerateContentResult {
  text: string;
  error?: string;
}

/** 无状态多消息调用中的单条消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 无状态多消息调用选项。
 * 不传则回落到 provider 在 initLLM 时设定的默认值。
 */
export interface ChatOptions {
  /** 采样温度。结构化输出建议压低（如 0.15） */
  temperature?: number;
  /** 最大输出 token */
  maxTokens?: number;
}
