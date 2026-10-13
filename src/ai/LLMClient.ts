/**
 * 统一 LLM 入口：由 VITE_LLM_PROVIDER 选择。
 */

import type { ChatMessage, ChatOptions, GenerateContentResult } from './LLMTypes';
import * as Ark from './ArkClient';
import * as Ollama from './OllamaClient';
import { LLM_PROVIDER, ARK_CONFIG, OLLAMA_CONFIG, getOllamaBaseUrl } from '../config/env';

export type { ChatMessage, ChatOptions, GenerateContentResult } from './LLMTypes';

export function initLLM(): void {
  if (LLM_PROVIDER === 'ollama') {
    Ollama.initOllama({
      baseUrl: getOllamaBaseUrl(),
      model: OLLAMA_CONFIG.model,
      temperature: OLLAMA_CONFIG.temperature,
      topP: OLLAMA_CONFIG.topP,
      numPredict: OLLAMA_CONFIG.numPredict,
      think: OLLAMA_CONFIG.think,
    });
  } else {
    Ark.initArk({
      apiKey: ARK_CONFIG.apiKey,
      baseUrl: ARK_CONFIG.baseUrl || undefined,
      apiKind: ARK_CONFIG.apiKind,
      model: ARK_CONFIG.model,
      temperature: ARK_CONFIG.temperature,
      topP: ARK_CONFIG.topP,
      maxTokens: ARK_CONFIG.maxTokens,
    });
  }
}

export function isLLMInitialized(): boolean {
  return LLM_PROVIDER === 'ollama' ? Ollama.isOllamaInitialized() : Ark.isArkInitialized();
}

export async function chat(userMessage: string): Promise<GenerateContentResult> {
  return LLM_PROVIDER === 'ollama' ? Ollama.chat(userMessage) : Ark.chat(userMessage);
}

/** 单轮生成，不写入多轮对话历史（用于剧情块摘要等） */
export async function generateContent(prompt: string): Promise<GenerateContentResult> {
  return LLM_PROVIDER === 'ollama' ? Ollama.generateContent(prompt) : Ark.generateContent(prompt);
}

/**
 * 无状态多消息生成：完整 messages 由调用方给出，不读写任何隐藏历史。
 * ReAct 循环用（思考轮 / 行为轮 / 反思轮）—— 重试必须确定性，
 * 因此解析成功但语义非法的输出不会污染后续上下文。
 */
export async function chatMessages(
  messages: ChatMessage[],
  options?: ChatOptions
): Promise<GenerateContentResult> {
  return LLM_PROVIDER === 'ollama'
    ? Ollama.chatWithMessages(messages, options)
    : Ark.chatWithMessages(messages, options);
}

export function setSystemInstruction(text: string): void {
  if (LLM_PROVIDER === 'ollama') Ollama.setSystemInstruction(text);
  else Ark.setSystemInstruction(text);
}

export function clearConversation(): void {
  if (LLM_PROVIDER === 'ollama') Ollama.clearConversation();
  else Ark.clearConversation();
}
