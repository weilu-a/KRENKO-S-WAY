/**
 * 环境变量配置
 * Vite 仅将 VITE_ 开头的变量暴露给前端，见 https://vitejs.dev/guide/env-and-mode
 */

function getEnv(key: string): string {
  const v = import.meta.env[key];
  return typeof v === 'string' ? v : '';
}

const DEFAULT_LL_TEMP = 0.8;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TOP_P = 0.95;

/** LLM 提供方：ark（火山方舟，默认）| ollama（本地） */
export type LLMProvider = 'ark' | 'ollama';
export const LLM_PROVIDER = (getEnv('VITE_LLM_PROVIDER') || 'ark') as LLMProvider;

/** 方舟 API Key，来自 .env 的 VITE_ARK_API_KEY（ark 时必填） */
export const ARK_API_KEY = getEnv('VITE_ARK_API_KEY');

/** 方舟调用方式：chat = OpenAI 兼容 POST .../chat/completions；responses = POST .../responses（如 Doubao-Seed 控制台示例） */
export type ArkApiKind = 'chat' | 'responses';
export const ARK_API_KIND = (getEnv('VITE_ARK_API_KIND') || 'chat') as ArkApiKind;

/** 方舟 OpenAI 兼容接口（默认 https://ark.cn-beijing.volces.com/api/v3） */
export const ARK_CONFIG = {
  apiKey: ARK_API_KEY,
  /** chat | responses，见 VITE_ARK_API_KIND */
  apiKind: ARK_API_KIND,
  /** 可选，例如自建代理；留空则使用 ArkClient 内建默认地址 */
  baseUrl: getEnv('VITE_ARK_BASE_URL'),
  model: getEnv('VITE_ARK_MODEL') || 'doubao-seed-2-0-lite-260215',
  temperature: Number(import.meta.env.VITE_ARK_TEMPERATURE) || DEFAULT_LL_TEMP,
  maxTokens: Number(import.meta.env.VITE_ARK_MAX_TOKENS) || DEFAULT_MAX_TOKENS,
  topP: Number(import.meta.env.VITE_ARK_TOP_P) || DEFAULT_TOP_P,
};

/**
 * Ollama 本地地址：
 * - 开发环境默认走 Vite 代理 `/ollama`（见 vite.config.ts），避免浏览器跨域
 * - 可显式设置 VITE_OLLAMA_BASE_URL，例如 http://127.0.0.1:11434
 */
export function getOllamaBaseUrl(): string {
  const fromEnv = getEnv('VITE_OLLAMA_BASE_URL');
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (import.meta.env.DEV) return '/ollama';
  return 'http://127.0.0.1:11434';
}

/** 本地 Ollama 模型名（与 `ollama list` 中一致，如 qwen2.5:9b） */
export const OLLAMA_CONFIG = {
  model: getEnv('VITE_OLLAMA_MODEL') || 'qwen2.5:9b',
  temperature: Number(import.meta.env.VITE_OLLAMA_TEMPERATURE) || DEFAULT_LL_TEMP,
  numPredict: Number(import.meta.env.VITE_OLLAMA_NUM_PREDICT) || DEFAULT_MAX_TOKENS,
  topP: Number(import.meta.env.VITE_OLLAMA_TOP_P) || DEFAULT_TOP_P,
  /** 仅部分模型支持；设为 true 开启推理/思考。默认 false（请求中带 think: false） */
  think: getEnv('VITE_OLLAMA_THINK') === 'true',
};
