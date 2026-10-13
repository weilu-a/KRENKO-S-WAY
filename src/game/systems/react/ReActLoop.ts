/**
 * ReAct 循环：思考轮 → 行为轮 → 引擎校验 → 回灌重试 → 静默反思。
 *
 * - 思考轮产出 {thought, reply}：thought 是指导行为的内部思考，reply 是直接给玩家的回复。
 * - 行为轮把 thought 与 reply 原文一起注入，只产出机器动作（actions）。
 * - 每个阶段最多 3 次尝试；失败时把「上一轮非法原文 + 具体错误」回灌给模型。
 * - 行为轮失败只重跑行为轮，沿用同一份 reply —— 保证玩家看到的回复不被推翻。
 * - 三次用尽则降级为「只呈现叙事」，绝不锁死状态机。
 * - 落地后 fire-and-forget 生成静默反思，注入**下一轮**思考轮。
 *
 * 本类不碰 UI 与游戏状态：产物交给 AIDirector.applyResponse 落地。
 * 中间产物与重试诊断一律只进 console，绝不走 onNarrate（否则会破坏对话队列顺序）。
 */

import { chatMessages, type ChatMessage, type ChatOptions } from '../../../ai/LLMClient';
import { isJsonObject, parseJsonLoose } from '../../../utils/json';
import { actionsToResponse, validateActions } from './ActionRegistry';
import {
  buildActInstruction,
  buildReasonInstruction,
  buildReflectInstruction,
  type PhaseFeedback,
  type ReflectionInput,
} from './Prompts';
import type {
  AIResponse,
  DMAction,
  ReActContext,
  ReActRoundResult,
  ReflectionRecord,
  RoundInput,
} from './ReActTypes';

/** 每个阶段（思考 / 行为）的最大尝试次数 */
const MAX_ATTEMPTS = 3;
/** 传输层错误（超时/网络抖动/5xx）的额外重试次数 */
const TRANSPORT_RETRIES = 1;
const TRANSPORT_RETRY_DELAY_MS = 500;

const TEMPERATURE = { reason: 0.75, act: 0.15, reflect: 0.3 } as const;
const MAX_TOKENS = { reason: 1024, act: 512, reflect: 512 } as const;

/** 鉴权/参数类错误：回灌 JSON 解决不了，直接结束本回合 */
const FATAL_ERROR_PATTERN =
  /401|403|400|未初始化|unauthorized|forbidden|invalid_request|api[-_ ]?key|authentication|model not found/i;

interface PhaseCall {
  text: string;
  error?: string;
}

/** 阶段结果：成功 / 三次产出无效 / 传输层失败 */
type PhaseResult<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; kind: 'invalid'; attempts: number }
  | { ok: false; kind: 'transport'; error: string; attempts: number };

interface ThoughtValue {
  thought: string;
  reply: string;
}

interface ActValue {
  actions: DMAction[];
  notes: string[];
}

function isFatalError(message: string): boolean {
  return FATAL_ERROR_PATTERN.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ReActLoop {
  /** 上一轮的静默反思，注入下一轮思考轮 */
  private lastReflection: ReflectionRecord | null = null;
  /** 在飞的反思调用；下一轮开始前先结算，保证「上轮反思进入下一轮」 */
  private pendingReflection: Promise<void> | null = null;
  private roundNo = 0;
  /** 用于丢弃跨场景的过期反思 */
  private reflectionEpoch = 0;

  /** 进入新剧情块时重置（跨场景记忆由 blockSummaries 承接） */
  reset(): void {
    this.lastReflection = null;
    this.reflectionEpoch += 1;
  }

  /* ────────── 一轮 ────────── */

  async runRound(ctx: ReActContext, input: RoundInput): Promise<ReActRoundResult> {
    await this.settlePendingReflection();
    this.roundNo += 1;

    /* ① 思考轮 */
    const reason = await this.runReasonPhase(ctx, input);
    if (!reason.ok && reason.kind === 'transport') {
      return this.degrade(null, '', reason.attempts, `（AI 错误：${reason.error}）`);
    }
    if (!reason.ok) {
      return this.degrade(
        null,
        '',
        reason.attempts,
        '（系统：DM 本回合未给出有效回应，请再说一次）'
      );
    }
    const { thought, reply } = reason.value;

    /* ② 行为轮（注入思考轮的两个产物原文） */
    const act = await this.runActPhase(ctx, thought, reply);
    const spent = reason.attempts + act.attempts;
    if (!act.ok && act.kind === 'transport') {
      return this.degrade(reply, thought, spent, `（AI 错误：${act.error}）`);
    }
    if (!act.ok) {
      return this.degrade(
        reply,
        thought,
        spent,
        '（系统：本回合的动作解析失败，仅呈现叙事，未产生任何效果）'
      );
    }

    /* ③ 校验已通过 → 交给 AIDirector 落地 */
    return {
      response: actionsToResponse(act.value.actions, reply),
      actions: act.value.actions,
      thought,
      degraded: false,
      attempts: spent,
      notes: act.value.notes,
    };
  }

  /* ────────── ① 思考轮 ────────── */

  private async runReasonPhase(ctx: ReActContext, input: RoundInput): Promise<PhaseResult<ThoughtValue>> {
    let feedback: PhaseFeedback | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`[ReAct] 思考轮 第 ${attempt}/${MAX_ATTEMPTS} 次`);
      const call = await this.requestWithTransportRetry(
        [
          { role: 'system', content: ctx.systemPrompt },
          { role: 'user', content: buildReasonInstruction(this.withReflection(ctx), input, feedback) },
        ],
        { temperature: TEMPERATURE.reason, maxTokens: MAX_TOKENS.reason },
        '思考轮'
      );
      if (call.error) return { ok: false, kind: 'transport', error: call.error, attempts: attempt };

      const parsed = this.parseThought(call.text);
      if (parsed.ok) {
        console.log('[ReAct] 思考:', parsed.value.thought);
        console.log('[ReAct] 回复:', parsed.value.reply || '（无正文，可能转场）');
        return { ok: true, value: parsed.value, attempts: attempt };
      }

      console.warn(
        '[ReAct] 思考轮输出无效（回灌重试）：',
        parsed.issues,
        '\n原始输出：',
        call.text
      );
      feedback = { raw: call.text, issues: parsed.issues };
    }

    return { ok: false, kind: 'invalid', attempts: MAX_ATTEMPTS };
  }

  /* ────────── ② 行为轮 ────────── */

  private async runActPhase(
    ctx: ReActContext,
    thought: string,
    reply: string
  ): Promise<PhaseResult<ActValue>> {
    let feedback: PhaseFeedback | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`[ReAct] 行为轮 第 ${attempt}/${MAX_ATTEMPTS} 次`);
      const call = await this.requestWithTransportRetry(
        [
          { role: 'system', content: ctx.systemPrompt },
          { role: 'user', content: buildActInstruction(ctx, thought, reply, feedback) },
        ],
        { temperature: TEMPERATURE.act, maxTokens: MAX_TOKENS.act },
        '行为轮'
      );
      if (call.error) return { ok: false, kind: 'transport', error: call.error, attempts: attempt };

      const parsed = parseJsonLoose(call.text);
      const validation = validateActions(parsed, ctx);

      if (!validation.ok) {
        console.warn(
          '[ReAct] 观察：行为轮输出无效（回灌重试）\n- ',
          validation.issues.join('\n- '),
          '\n原始输出：',
          call.text
        );
        feedback = { raw: call.text, issues: validation.issues };
        continue;
      }

      if (validation.notes.length > 0) {
        console.warn('[ReAct] 观察（引擎软修正）：\n- ', validation.notes.join('\n- '));
      }
      console.log('[ReAct] 行为:', validation.actions);

      return {
        ok: true,
        value: { actions: validation.actions, notes: validation.notes },
        attempts: attempt,
      };
    }

    return { ok: false, kind: 'invalid', attempts: MAX_ATTEMPTS };
  }

  /** 单次调用 + 非致命传输错误的额外重试 */
  private async requestWithTransportRetry(
    messages: ChatMessage[],
    options: ChatOptions,
    label: string
  ): Promise<PhaseCall> {
    let result = await chatMessages(messages, options);
    for (let i = 0; i < TRANSPORT_RETRIES; i++) {
      if (!result.error || isFatalError(result.error)) return result;
      console.warn(
        `[ReAct] ${label}请求失败，${TRANSPORT_RETRY_DELAY_MS}ms 后重试：${result.error}`
      );
      await delay(TRANSPORT_RETRY_DELAY_MS);
      result = await chatMessages(messages, options);
    }
    return result;
  }

  /* ────────── 解析 ────────── */

  private parseThought(
    text: string
  ): { ok: true; value: ThoughtValue } | { ok: false; issues: string[] } {
    const parsed = parseJsonLoose(text);
    if (!isJsonObject(parsed)) {
      return {
        ok: false,
        issues: ['输出不是合法 JSON 对象，请按要求返回 {"thought":"...","reply":"..."}'],
      };
    }
    const thought = String(parsed.thought ?? '').trim();
    const reply = String(parsed.reply ?? '').trim();
    const issues: string[] = [];
    if (!thought) issues.push('thought 为空：必须写出你的内部思考');
    if (!reply) issues.push('reply 为空：必须给出对玩家的中文回复（即使极短）');
    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, value: { thought, reply } };
  }

  /* ────────── 静默反思 ────────── */

  /**
   * 落地完成后调用：后台生成反思，注入下一轮思考轮。
   * fire-and-forget —— 不碰 isProcessing / onProcessing，失败也不影响主流程。
   */
  startReflection(ctx: ReActContext, data: ReflectionInput): void {
    const epoch = this.reflectionEpoch;
    const roundNo = this.roundNo;
    this.pendingReflection = this.runReflection(ctx, data, roundNo, epoch).catch((err) => {
      console.warn('[ReAct] 反思轮异常（已忽略）：', err);
    });
  }

  private async runReflection(
    ctx: ReActContext,
    data: ReflectionInput,
    roundNo: number,
    epoch: number
  ): Promise<void> {
    const result = await chatMessages(
      [
        { role: 'system', content: ctx.systemPrompt },
        { role: 'user', content: buildReflectInstruction(ctx, data) },
      ],
      { temperature: TEMPERATURE.reflect, maxTokens: MAX_TOKENS.reflect }
    );
    if (result.error) {
      console.warn('[ReAct] 反思轮失败（已忽略）：', result.error);
      return;
    }

    // 反思绝不影响主流程：解析不出来就把原文当反思
    const parsed = parseJsonLoose(result.text);
    const record: ReflectionRecord = isJsonObject(parsed)
      ? {
          text: String(parsed.reflection ?? '').trim() || result.text.trim().slice(0, 800),
          focus: Array.isArray(parsed.nextFocus)
            ? parsed.nextFocus.map((f) => String(f).trim()).filter(Boolean).slice(0, 3)
            : [],
          roundNo,
        }
      : { text: result.text.trim().slice(0, 800), focus: [], roundNo };

    if (epoch !== this.reflectionEpoch) {
      console.log('[ReAct] 反思已跨场景，丢弃（不影响新场景）');
      return;
    }
    this.lastReflection = record;
    console.log(
      '[ReAct] 反思:',
      record.text,
      record.focus.length > 0 ? `\n要点：${record.focus.join('；')}` : ''
    );
  }

  /** 下一轮开始前结算未完成的反思，保证它确实进入下一轮 */
  private async settlePendingReflection(): Promise<void> {
    const pending = this.pendingReflection;
    if (!pending) return;
    this.pendingReflection = null;
    try {
      await pending;
    } catch (err) {
      console.warn('[ReAct] 等待反思失败（已忽略）：', err);
    }
  }

  /** 供思考轮注入的反思文本 */
  private formatReflection(): string {
    const record = this.lastReflection;
    if (!record) return '';
    const focus = record.focus.length > 0 ? `\n下轮要点：${record.focus.join('；')}` : '';
    return `${record.text}${focus}`;
  }

  /** 把 loop 内的反思快照并进上下文（思考轮调用前使用） */
  private withReflection(ctx: ReActContext): ReActContext {
    return { ...ctx, lastReflection: this.formatReflection() };
  }

  /* ────────── 降级 ────────── */

  private degrade(
    reply: string | null,
    thought: string,
    attempts: number,
    notice: string
  ): ReActRoundResult {
    console.warn(`[ReAct] 降级（共 ${attempts} 次尝试）：${notice}`);
    const response: AIResponse = {
      narrative: reply ?? '',
      dice: null,
      items: [],
      hp: 0,
      flags: [],
      next: null,
      battlePrefabId: null,
      sceneVisualId: null,
      npcEffects: [],
    };
    return {
      response,
      actions: [],
      thought,
      degraded: true,
      degradedNotice: notice,
      attempts,
      notes: [],
    };
  }
}
