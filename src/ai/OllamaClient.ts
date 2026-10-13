/**
 * 本地 Ollama HTTP API（/api/chat），与 ArkClient 相同的多轮对话语义。
 * 开发环境下建议走 Vite 代理 /ollama → 127.0.0.1:11434，避免浏览器 CORS。
 */

import type { ChatMessage, ChatOptions, GenerateContentResult } from './LLMTypes';

export interface OllamaInitOptions {
  /** 如 http://127.0.0.1:11434 或开发时代理前缀 /ollama */
  baseUrl: string;
  model: string;
  temperature?: number;
  topP?: number;
  numPredict?: number;
  /**
   * 是否开启「思考/推理」模式（Qwen3 等）；默认 false。
   * 关闭时请求体会带 think: false（Ollama 顶层字段）。
   */
  think?: boolean;
}

interface OllamaChatResponse {
  message?: { role?: string; content?: string; thinking?: string };
  error?: string;
}

let baseUrl = '';
let model = '';
let thinkEnabled = false;
let genOptions = { temperature: 0.8, top_p: 0.95, num_predict: 1024 };

let systemInstruction = '';
let conversationHistory: Array<{ role: string; parts: Array<{ text: string }> }> = [];

const MAX_HISTORY_ENTRIES = 20;
const MAX_HISTORY_CHARS = 12000;

function trimHistory(): void {
  while (conversationHistory.length > MAX_HISTORY_ENTRIES) {
    conversationHistory.shift();
  }
  const totalChars = () =>
    conversationHistory.reduce(
      (sum, msg) => sum + msg.parts.reduce((s, p) => s + p.text.length, 0),
      0
    );
  while (totalChars() > MAX_HISTORY_CHARS && conversationHistory.length > 2) {
    const removed = conversationHistory.shift()!;
    if (conversationHistory.length > 1 && conversationHistory[0].role !== 'user') {
      conversationHistory.shift();
    }
    console.log(`[Ollama] 历史裁剪：移除旧消息(${removed.role})，当前 ${conversationHistory.length} 条`);
  }
}

export function initOllama(options: OllamaInitOptions): void {
  baseUrl = options.baseUrl.replace(/\/$/, '');
  model = options.model;
  thinkEnabled = options.think ?? false;
  genOptions = {
    temperature: options.temperature ?? 0.8,
    top_p: options.topP ?? 0.95,
    num_predict: options.numPredict ?? 1024,
  };
}

export function isOllamaInitialized(): boolean {
  return Boolean(baseUrl && model);
}

export function setSystemInstruction(text: string): void {
  systemInstruction = text;
}

export function clearConversation(): void {
  conversationHistory = [];
}

function buildOllamaMessages(): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }
  for (const h of conversationHistory) {
    const text = h.parts[0]?.text ?? '';
    if (h.role === 'user') {
      messages.push({ role: 'user', content: text });
    } else {
      messages.push({ role: 'assistant', content: text });
    }
  }
  return messages;
}

/**
 * 多轮对话
 */
export async function chat(userMessage: string): Promise<GenerateContentResult> {
  if (!baseUrl || !model) {
    return { text: '', error: 'Ollama 未初始化，请设置 VITE_LLM_PROVIDER=ollama 与 VITE_OLLAMA_MODEL' };
  }

  conversationHistory.push({ role: 'user', parts: [{ text: userMessage }] });
  trimHistory();

  const url = `${baseUrl}/api/chat`;
  const body: Record<string, unknown> = {
    model,
    messages: buildOllamaMessages(),
    stream: false,
    options: {
      temperature: genOptions.temperature,
      top_p: genOptions.top_p,
      num_predict: genOptions.num_predict,
    },
  };
  // 顶层 think 字段：关闭推理时显式 false（见 Ollama Qwen3 文档）
  body.think = thinkEnabled;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as OllamaChatResponse;
    if (!res.ok) {
      conversationHistory.pop();
      const err = data.error ?? res.statusText;
      return { text: '', error: `Ollama 错误: ${err}` };
    }

    if (data.error) {
      conversationHistory.pop();
      return { text: '', error: `Ollama 错误: ${data.error}` };
    }

    const content = data.message?.content?.trim() ?? '';
    if (!content) {
      conversationHistory.pop();
      return { text: '', error: '模型未返回内容' };
    }

    conversationHistory.push({ role: 'model', parts: [{ text: content }] });
    return { text: content };
  } catch (e) {
    conversationHistory.pop();
    const err = e instanceof Error ? e.message : String(e);
    console.error('[Ollama]', err);
    return {
      text: '',
      error: `请求失败: ${err}（若为本机 Ollama，请确认已启动，且开发环境已配置 Vite 代理 /ollama）`,
    };
  }
}

/**
 * 无状态多消息生成：messages 由调用方完整给出，不读不写 conversationHistory。
 * maxTokens 映射到 Ollama 的 num_predict；think 沿用初始化时的开关。
 */
export async function chatWithMessages(
  messages: ChatMessage[],
  options?: ChatOptions
): Promise<GenerateContentResult> {
  if (!baseUrl || !model) {
    return { text: '', error: 'Ollama 未初始化，请设置 VITE_LLM_PROVIDER=ollama 与 VITE_OLLAMA_MODEL' };
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    options: {
      temperature: options?.temperature ?? genOptions.temperature,
      top_p: genOptions.top_p,
      num_predict: options?.maxTokens ?? genOptions.num_predict,
    },
  };
  body.think = thinkEnabled;

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as OllamaChatResponse;
    if (!res.ok) {
      return { text: '', error: `Ollama 错误: ${data.error ?? res.statusText}` };
    }
    if (data.error) {
      return { text: '', error: `Ollama 错误: ${data.error}` };
    }

    const content = data.message?.content?.trim() ?? '';
    if (!content) {
      return { text: '', error: '模型未返回内容' };
    }
    return { text: content };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return {
      text: '',
      error: `请求失败: ${err}（若为本机 Ollama，请确认已启动，且开发环境已配置 Vite 代理 /ollama）`,
    };
  }
}

/**
 * 单轮生成，不修改 conversationHistory（用于剧情块摘要等）
 */
export async function generateContent(prompt: string): Promise<GenerateContentResult> {
  if (!baseUrl || !model) {
    return { text: '', error: 'Ollama 未初始化，请设置 VITE_LLM_PROVIDER=ollama 与 VITE_OLLAMA_MODEL' };
  }
  const url = `${baseUrl}/api/chat`;
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    options: {
      temperature: genOptions.temperature,
      top_p: genOptions.top_p,
      num_predict: genOptions.num_predict,
    },
  };
  body.think = thinkEnabled;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as OllamaChatResponse;
    if (!res.ok) {
      const err = data.error ?? res.statusText;
      return { text: '', error: `Ollama 错误: ${err}` };
    }
    if (data.error) {
      return { text: '', error: `Ollama 错误: ${data.error}` };
    }
    const content = data.message?.content?.trim() ?? '';
    if (!content) {
      return { text: '', error: '模型未返回内容' };
    }
    return { text: content };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { text: '', error: `请求失败: ${err}` };
  }
}
