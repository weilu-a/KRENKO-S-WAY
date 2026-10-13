/**
 * ReAct（Reasoning + Acting）循环的类型契约。
 *
 * 一轮 = 思考轮（thought + reply）→ 行为轮（actions）→ 引擎校验 → 落地 → 静默反思。
 * @see ReActLoop
 */

import type { NpcId } from '../../data/GameProgress';

/* ────────── 检定 ────────── */

/** 检定只用六项属性名（无技能列表） */
export const SKILLS = ['力量', '敏捷', '体质', '智力', '感知', '魅力'] as const;
export type Skill = (typeof SKILLS)[number];

export interface DiceCheckInfo {
  skill: string;
  dc: number;
  reason: string;
}

/* ────────── 落地用的响应结构（沿用改造前的形状，供 AIDirector.applyResponse 消费） ────────── */

export interface AIResponse {
  narrative: string;
  dice: DiceCheckInfo | null;
  items: Array<{ id: string; delta: number }>;
  hp: number;
  flags: string[];
  next: string | null;
  /** 引用 BattlePrefabs 中预制战斗（多轮检定）；与 dice 二选一 */
  battlePrefabId?: string | null;
  /** 同块内子场景立绘（如锡街酒馆）；见 SceneBackgrounds */
  sceneVisualId?: string | null;
  /** 关键 NPC 关系变化（轻量分支） */
  npcEffects?: Array<{ npc: NpcId; delta: number; tag?: string | null }>;
}

/* ────────── 思考轮 ────────── */

/** 思考轮产物：内部思考 + 直接给玩家的回复 */
export interface ThoughtStep {
  /** 指导行为的自然语言思考，不给玩家看（仅 console） */
  thought: string;
  /** 直接给玩家的中文回复 */
  reply: string;
}

/* ────────── 行为轮 ────────── */

export type DMAction =
  | { type: 'dice'; skill: Skill; dc: number; reason: string }
  | { type: 'battle'; prefabId: string }
  | { type: 'hp'; delta: number }
  | { type: 'item'; id: string; delta: number }
  | { type: 'flag'; name: string }
  | { type: 'scene_visual'; key: string }
  | { type: 'transition'; blockId: string }
  | { type: 'npc_effect'; npc: NpcId; delta: number; tag?: string };

export const ACTION_TYPES = [
  'dice',
  'battle',
  'hp',
  'item',
  'flag',
  'scene_visual',
  'transition',
  'npc_effect',
] as const;

/** 动作校验结果 */
export interface ActionValidation {
  /** 无硬错误才为 true；false 时 actions 不可用于落地 */
  ok: boolean;
  actions: DMAction[];
  /** 硬错误：引擎无法无歧义修复，需回灌重试 */
  issues: string[];
  /** 软修正与引擎侧说明：只记日志、供反思使用，不触发重试 */
  notes: string[];
}

/* ────────── 回合输入与上下文 ────────── */

/** 触发一轮 ReAct 的输入 */
export type RoundInput =
  | { kind: 'player'; text: string }
  | {
      kind: 'dice';
      check: DiceCheckInfo;
      rawRoll: number;
      modifier: number;
      total: number;
      success: boolean;
    };

/**
 * 本回合上下文快照。每个阶段调用前由 AIDirector 重新构建，
 * 保证 HP/背包/flags 等状态是同一回合的最新值。
 */
export interface ReActContext {
  blockId: string;
  blockName: string;
  /** 系统提示（世界观 + 规则 + 状态 + 白名单，不含输出格式） */
  systemPrompt: string;
  /** 最近若干轮紧凑历史（由 blockTranscript 渲染） */
  history: string;
  /** 上一轮静默反思；无则空串 */
  lastReflection: string;
  /** 本块允许的转场 id（白名单） */
  allowedTransitions: string[];
  /** 本块可用预制战斗槽 id */
  battleSlots: string[];
  /** 本块可用子场景立绘键 */
  sceneVisualKeys: string[];
  /** 进行中的预制战斗链；无则 null */
  combatChain: { index: number; total: number } | null;
  /** 本场景已触发战斗次数 */
  battlesThisScene: number;
  /** 本场景战斗上限 */
  battleLimit: number;
}

/* ────────── 反思轮 ────────── */

/** 静默反思记录：本轮结束后的自省，注入下一轮思考 */
export interface ReflectionRecord {
  /** 反思正文 */
  text: string;
  /** 下轮需注意的要点 */
  focus: string[];
  /** 产生该反思的回合序号（调试用） */
  roundNo: number;
}

/* ────────── 回合结果 ────────── */

export interface ReActRoundResult {
  /** 交给 AIDirector.applyResponse 的已校验响应 */
  response: AIResponse;
  /** 本回合实际落地的动作（降级时为空数组） */
  actions: DMAction[];
  /** 本回合思考（调试/日志） */
  thought: string;
  /** 三次尝试用尽而降级（actions 为空，仅叙事） */
  degraded: boolean;
  /** 降级时给玩家的 system 提示；正常为 undefined */
  degradedNotice?: string;
  /** 实际消耗的尝试次数 */
  attempts: number;
  /** 引擎软修正说明（供反思使用） */
  notes: string[];
}
