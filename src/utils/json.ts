/**
 * 从模型返回文本里稳健地取出 JSON 对象。
 * 模型常见的三种包装：裸 JSON、```json 代码块、JSON 前后带解说文字。
 */

/** 剥掉 markdown 代码块围栏；无围栏时返回原文本 */
function stripCodeFence(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1]!.trim() : text;
}

/** 截取第一个 `{` 到最后一个 `}` 之间的内容；找不到返回原文本 */
function sliceOutermostObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return text;
  return text.slice(start, end + 1);
}

/**
 * 宽松解析：先剥代码块再截取最外层对象，最后 JSON.parse。
 * 成功返回解析值（调用方自行断言形状）；失败返回 null，绝不抛异常。
 */
export function parseJsonLoose(text: string): unknown {
  if (!text) return null;
  const candidates = [text.trim(), stripCodeFence(text.trim())];
  for (const candidate of candidates) {
    const sliced = sliceOutermostObject(candidate);
    for (const attempt of [candidate, sliced]) {
      try {
        return JSON.parse(attempt);
      } catch {
        /* 换下一个候选形态 */
      }
    }
  }
  return null;
}

/** 判断宽松解析结果是否为可当字典使用的对象 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
