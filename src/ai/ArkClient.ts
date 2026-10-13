/**
 * 火山引擎方舟
 * - chat：OpenAI 兼容 POST {base}/chat/completions
 * - responses：POST {base}/responses（豆包 Seed 等控制台示例）
 */

import type { ChatMessage, ChatOptions, GenerateContentResult } from './LLMTypes';

const DEFAULT_API_BASE = 'https://ark.cn-beijing.volces.com/api/v3';

export interface ArkInitOptions {
  apiKey: string;
  /** 默认 https://ark.cn-beijing.volces.com/api/v3 */
  baseUrl?: string;
  /** chat（默认）| responses */
  apiKind?: 'chat' | 'responses';
  model: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

interface ArkChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ArkChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string; code?: string };
}

let apiKey = '';
let apiBase = DEFAULT_API_BASE;
let apiKind: 'chat' | 'responses' = 'chat';
let model = '';
let genOptions = { temperature: 0.8, top_p: 0.95, max_tokens: 1024 };

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
    console.log(`[Ark] 历史裁剪：移除旧消息(${removed.role})，当前 ${conversationHistory.length} 条`);
  }
}

export function initArk(options: ArkInitOptions): void {
  apiKey = options.apiKey;
  apiBase = (options.baseUrl || DEFAULT_API_BASE).replace(/\/$/, '');
  apiKind = options.apiKind ?? 'chat';
  model = options.model;
  genOptions = {
    temperature: options.temperature ?? 0.8,
    top_p: options.topP ?? 0.95,
    max_tokens: options.maxTokens ?? 1024,
  };
}

export function isArkInitialized(): boolean {
  return Boolean(apiKey && model);
}

export function setSystemInstruction(text: string): void {
  systemInstruction = text;
}

export function clearConversation(): void {
  conversationHistory = [];
}

function buildMessages(): ArkChatMessage[] {
  const messages: ArkChatMessage[] = [];
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

/** Responses API：input 内每条 content 为 input_text 块 */
function buildResponsesInput(): Array<{
  role: 'system' | 'user' | 'assistant';
  content: Array<{ type: 'input_text'; text: string }>;
}> {
  const input: Array<{
    role: 'system' | 'user' | 'assistant';
    content: Array<{ type: 'input_text'; text: string }>;
  }> = [];
  if (systemInstruction) {
    input.push({
      role: 'system',
      content: [{ type: 'input_text', text: systemInstruction }],
    });
  }
  for (const h of conversationHistory) {
    const text = h.parts[0]?.text ?? '';
    if (h.role === 'user') {
      input.push({ role: 'user', content: [{ type: 'input_text', text }] });
    } else {
      input.push({
        role: 'assistant',
        content: [{ type: 'input_text', text }],
      });
    }
  }
  return input;
}

function chatCompletionsUrl(): string {
  return `${apiBase}/chat/completions`;
}

function responsesUrl(): string {
  return `${apiBase}/responses`;
}

/** 从 Responses API 返回体中提取文本（兼容多种字段） */
function extractResponsesOutputText(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  const err = d.error as { message?: string } | undefined;
  if (err?.message) return '';

  const out = d.output;
  if (Array.isArray(out)) {
    const texts: string[] = [];
    for (const item of out) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const c = o.content;
      if (Array.isArray(c)) {
        for (const part of c) {
          if (part && typeof part === 'object') {
            const p = part as Record<string, unknown>;
            if (typeof p.text === 'string') texts.push(p.text);
          }
        }
      }
      if (typeof o.text === 'string') texts.push(o.text);
    }
    if (texts.length) return texts.join('\n').trim();
  }

  if (typeof d.output_text === 'string') return d.output_text.trim();

  const choices = d.choices as Array<{ message?: { content?: string } }> | undefined;
  const c0 = choices?.[0]?.message?.content;
  if (typeof c0 === 'string') return c0.trim();

  return '';
}

export async function chat(userMessage: string): Promise<GenerateContentResult> {
  if (!apiKey || !model) {
    return { text: '', error: '方舟未初始化，请在 .env 配置 VITE_ARK_API_KEY 与 VITE_ARK_MODEL' };
  }

  conversationHistory.push({ role: 'user', parts: [{ text: userMessage }] });
  trimHistory();

  if (apiKind === 'responses') {
    return chatViaResponses();
  }

  const messages = buildMessages();

  try {
    const res = await fetch(chatCompletionsUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: genOptions.temperature,
        top_p: genOptions.top_p,
        max_tokens: genOptions.max_tokens,
      }),
    });

    const data = (await res.json()) as ArkChatResponse;

    if (!res.ok) {
      conversationHistory.pop();
      const errMsg = data.error?.message ?? res.statusText;
      return { text: '', error: `方舟 API 错误: ${errMsg}` };
    }

    const content = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) {
      conversationHistory.pop();
      return { text: '', error: '方舟未返回内容' };
    }

    conversationHistory.push({ role: 'model', parts: [{ text: content }] });
    return { text: content };
  } catch (e) {
    conversationHistory.pop();
    const err = e instanceof Error ? e.message : String(e);
    return { text: '', error: `方舟请求失败: ${err}` };
  }
}

async function chatViaResponses(): Promise<GenerateContentResult> {
  const input = buildResponsesInput();
  try {
    const res = await fetch(responsesUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      // Responses API 与 chat/completions 字段不同，勿传 max_tokens 等未知字段
      body: JSON.stringify({
        model,
        input,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      conversationHistory.pop();
      const errMsg =
        (data as ArkChatResponse).error?.message ??
        (data as { message?: string }).message ??
        res.statusText;
      return { text: '', error: `方舟 API 错误: ${errMsg}` };
    }

    const content = extractResponsesOutputText(data);
    if (!content) {
      conversationHistory.pop();
      return { text: '', error: '方舟未返回内容' };
    }

    conversationHistory.push({ role: 'model', parts: [{ text: content }] });
    return { text: content };
  } catch (e) {
    conversationHistory.pop();
    const err = e instanceof Error ? e.message : String(e);
    return { text: '', error: `方舟请求失败: ${err}` };
  }
}

/**
 * 无状态多消息生成：messages 由调用方完整给出，不读不写 conversationHistory。
 * 两种 apiKind 都要支持（responses 分支不发 max_tokens，见下方注释）。
 */
export async function chatWithMessages(
  messages: ChatMessage[],
  options?: ChatOptions
): Promise<GenerateContentResult> {
  if (!apiKey || !model) {
    return { text: '', error: '方舟未初始化，请在 .env 配置 VITE_ARK_API_KEY 与 VITE_ARK_MODEL' };
  }

  if (apiKind === 'responses') {
    return chatWithMessagesViaResponses(messages);
  }

  const temperature = options?.temperature ?? genOptions.temperature;
  const maxTokens = options?.maxTokens ?? genOptions.max_tokens;

  try {
    const res = await fetch(chatCompletionsUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        top_p: genOptions.top_p,
        max_tokens: maxTokens,
      }),
    });

    const data = (await res.json()) as ArkChatResponse;
    if (!res.ok) {
      const errMsg = data.error?.message ?? res.statusText;
      return { text: '', error: `方舟 API 错误: ${errMsg}` };
    }

    const content = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) {
      return { text: '', error: '方舟未返回内容' };
    }
    return { text: content };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { text: '', error: `方舟请求失败: ${err}` };
  }
}

async function chatWithMessagesViaResponses(
  messages: ChatMessage[]
): Promise<GenerateContentResult> {
  const input = messages.map((m) => ({
    role: m.role,
    content: [{ type: 'input_text' as const, text: m.content }],
  }));

  try {
    const res = await fetch(responsesUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      // Responses API 与 chat/completions 字段不同，勿传 max_tokens 等未知字段
      body: JSON.stringify({ model, input }),
    });

    const data = await res.json();
    if (!res.ok) {
      const errMsg =
        (data as ArkChatResponse).error?.message ??
        (data as { message?: string }).message ??
        res.statusText;
      return { text: '', error: `方舟 API 错误: ${errMsg}` };
    }

    const content = extractResponsesOutputText(data);
    if (!content) {
      return { text: '', error: '方舟未返回内容' };
    }
    return { text: content };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { text: '', error: `方舟请求失败: ${err}` };
  }
}

/** 单轮生成，不写入多轮历史（与 DM 系统提示无关，仅 user 任务文本） */
export async function generateContent(prompt: string): Promise<GenerateContentResult> {
  if (!apiKey || !model) {
    return { text: '', error: '方舟未初始化' };
  }

  if (apiKind === 'responses') {
    try {
      const res = await fetch(responsesUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: 'user',
              content: [{ type: 'input_text', text: prompt }],
            },
          ],
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const errMsg =
          (data as ArkChatResponse).error?.message ??
          (data as { message?: string }).message ??
          res.statusText;
        return { text: '', error: `方舟 API 错误: ${errMsg}` };
      }
      const content = extractResponsesOutputText(data);
      if (!content) {
        return { text: '', error: '方舟未返回内容' };
      }
      return { text: content };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      return { text: '', error: `方舟请求失败: ${err}` };
    }
  }

  const messages: ArkChatMessage[] = [{ role: 'user', content: prompt }];

  try {
    const res = await fetch(chatCompletionsUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: genOptions.temperature,
        top_p: genOptions.top_p,
        max_tokens: genOptions.max_tokens,
      }),
    });

    const data = (await res.json()) as ArkChatResponse;
    if (!res.ok) {
      const errMsg = data.error?.message ?? res.statusText;
      return { text: '', error: `方舟 API 错误: ${errMsg}` };
    }
    const content = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) {
      return { text: '', error: '方舟未返回内容' };
    }
    return { text: content };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { text: '', error: `方舟请求失败: ${err}` };
  }
}
