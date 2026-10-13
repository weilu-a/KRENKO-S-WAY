/**
 * 行为轮的动作目录（注入提示词）与引擎侧校验。
 *
 * 校验分两类：
 * - 硬错误（issues）：引擎无法无歧义修复 → 回灌重试（如转场 id 不在白名单、未知物品 id）。
 * - 软修正（notes）：引擎可直接改好或按既有语义忽略 → 只记日志，不重试（如 DC 越界钳制、
 *   战斗链进行中出现的 dice/battle 丢弃）。
 */

import { ITEMS, ITEMS_BY_ID } from '../../data/Items';
import { BATTLE_PREFABS } from '../../data/BattlePrefabs';
import type { NpcId } from '../../data/GameProgress';
import {
  ACTION_TYPES,
  SKILLS,
  type ActionValidation,
  type AIResponse,
  type DMAction,
  type ReActContext,
  type Skill,
} from './ReActTypes';

/** 关键 NPC 枚举（与 GameProgress.NpcId 同步） */
const NPC_IDS: readonly NpcId[] = ['nassius', 'krenko', 'falish', 'shattergang'];

const DC_MIN = 5;
const DC_MAX = 25;
const HP_DELTA_MAX = 15;
const FLAG_MAX_CHARS = 40;

const ITEM_ID_MAP = ITEMS.map((i) => `${i.id}=${i.name}(${i.kind})`).join('|');

/* ────────── 动作目录（注入行为轮提示词） ────────── */

/** 静态动作格式说明 */
export function formatActionCatalog(): string {
  return `【可用动作】（type 固定，字段如下；不需要任何动作时 actions 返回空数组）
- {"type":"dice","skill":"力量|敏捷|体质|智力|感知|魅力 之一","dc":数字 5~25,"reason":"检定原因"} —— 需要玩家掷骰的六维检定
- {"type":"battle","prefabId":"预制战斗ID"} —— 触发多轮预制战斗（仅在无进行中战斗链、且本场景战斗未达上限时）
- {"type":"hp","delta":数字} —— 玩家 HP 变化量，正数回复、负数受伤，绝对值不超过 ${HP_DELTA_MAX}
- {"type":"item","id":"物品ID","delta":数字} —— 物品增减；增为正、减为负
- {"type":"flag","name":"简短情报标记"} —— 记入已获情报
- {"type":"scene_visual","key":"子场景立绘键"} —— 仅在叙事已发生对应空间位移时
- {"type":"transition","blockId":"BLOCK_XX"} —— 仅玩家明确动身前往时
- {"type":"npc_effect","npc":"nassius|krenko|falish|shattergang","delta":-1|0|1,"tag":"可选标签"} —— 关键 NPC 关系变化

【物品ID速查】${ITEM_ID_MAP}`;
}

/** 动态约束（白名单与战斗链禁令），随上下文变化 */
export function formatActionConstraints(ctx: ReActContext): string {
  const lines: string[] = [];

  lines.push(
    ctx.allowedTransitions.length > 0
      ? `【本场景允许的 transition.blockId】（仅此列表中的 ID，无位移则不要输出 transition 动作）\n${ctx.allowedTransitions.join('、')}`
      : '【本场景无后续转场】不要输出 transition 动作。'
  );

  if (ctx.battleSlots.length > 0) {
    lines.push(
      `【本场景可用预制战斗槽】${ctx.battleSlots
        .map((id) => `${id}（${BATTLE_PREFABS[id]?.title ?? id}）`)
        .join('；')}`
    );
  } else {
    lines.push('【本场景无预制战斗槽】不要输出 battle 动作。');
  }

  lines.push(
    ctx.sceneVisualKeys.length > 0
      ? `【本块可填的 scene_visual.key】${ctx.sceneVisualKeys.join('、')}（无空间位移则不输出该动作）`
      : '【本块无子场景立绘】不要输出 scene_visual 动作。'
  );

  if (ctx.combatChain) {
    lines.push(
      `【战斗进行中】预制战斗链第 ${ctx.combatChain.index + 1}/${ctx.combatChain.total} 轮尚未走完，本轮**禁止**输出 dice 与 battle 动作（后续轮次由引擎自动排队）。`
    );
  } else if (ctx.battlesThisScene >= ctx.battleLimit) {
    lines.push(
      `【战斗已达上限】本场景已触发 ${ctx.battlesThisScene}/${ctx.battleLimit} 场战斗，本轮**禁止**输出 battle 动作。`
    );
  }

  return lines.join('\n');
}

/* ────────── 校验 ────────── */

/** 把模型给的 skill 文本归一化到六维之一 */
function normalizeSkill(value: unknown): Skill | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return SKILLS.find((s) => text.includes(s)) ?? null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 校验行为轮输出。
 * @param raw 行为轮解析出的原始 JSON（可能是 null）
 * @param ctx 本回合上下文（提供白名单）
 */
export function validateActions(raw: unknown, ctx: ReActContext): ActionValidation {
  const issues: string[] = [];
  const notes: string[] = [];
  const actions: DMAction[] = [];

  if (!isPlainObject(raw)) {
    return { ok: false, actions: [], issues: ['返回内容不是合法的 JSON 对象'], notes };
  }

  const rawActions = raw.actions;
  if (!Array.isArray(rawActions)) {
    return { ok: false, actions: [], issues: ['缺少 actions 字段，或 actions 不是数组'], notes };
  }

  rawActions.forEach((entry, index) => {
    const label = `动作 #${index + 1}`;
    if (!isPlainObject(entry)) {
      issues.push(`${label} 不是对象`);
      return;
    }
    const type = String(entry.type ?? '').trim();
    if (!(ACTION_TYPES as readonly string[]).includes(type)) {
      issues.push(
        `${label} 的 type "${type || '(空)'}" 未知，只能是：${ACTION_TYPES.join('|')}`
      );
      return;
    }

    switch (type) {
      case 'dice': {
        const skill = normalizeSkill(entry.skill);
        if (!skill) {
          issues.push(
            `${label}(dice) 的 skill "${String(entry.skill ?? '')}" 非法，必须是：${SKILLS.join('|')}`
          );
          return;
        }
        const rawDc = Number(entry.dc);
        if (!Number.isFinite(rawDc)) {
          issues.push(`${label}(dice) 的 dc 不是数字`);
          return;
        }
        const dc = Math.max(DC_MIN, Math.min(DC_MAX, Math.round(rawDc)));
        if (dc !== Math.round(rawDc)) {
          notes.push(`${label}(dice) dc ${rawDc} 越界，已钳制为 ${dc}`);
        }
        const reason = String(entry.reason ?? '').trim() || '（未说明检定原因）';
        actions.push({ type: 'dice', skill, dc, reason });
        return;
      }

      case 'battle': {
        const prefabId = String(entry.prefabId ?? '').trim();
        if (!ctx.battleSlots.includes(prefabId)) {
          issues.push(
            `${label}(battle) 的 prefabId "${prefabId}" 不在本场景战斗槽内，只能是：${
              ctx.battleSlots.join('、') || '（本场景无战斗槽）'
            }`
          );
          return;
        }
        if (!BATTLE_PREFABS[prefabId]?.rounds?.length) {
          issues.push(`${label}(battle) 的 prefabId "${prefabId}" 没有可用轮次`);
          return;
        }
        actions.push({ type: 'battle', prefabId });
        return;
      }

      case 'hp': {
        const rawDelta = Number(entry.delta);
        if (!Number.isFinite(rawDelta)) {
          issues.push(`${label}(hp) 的 delta 不是数字`);
          return;
        }
        let delta = Math.round(rawDelta);
        if (delta === 0) {
          notes.push(`${label}(hp) delta 为 0，已忽略`);
          return;
        }
        if (Math.abs(delta) > HP_DELTA_MAX) {
          notes.push(`${label}(hp) delta ${delta} 过大，已钳制为 ±${HP_DELTA_MAX}`);
          delta = Math.sign(delta) * HP_DELTA_MAX;
        }
        actions.push({ type: 'hp', delta });
        return;
      }

      case 'item': {
        const id = String(entry.id ?? '').trim();
        if (!ITEMS_BY_ID[id]) {
          issues.push(`${label}(item) 的 id "${id}" 不在物品表内`);
          return;
        }
        const rawDelta = Number(entry.delta);
        if (!Number.isFinite(rawDelta) || Math.round(rawDelta) === 0) {
          issues.push(`${label}(item) 的 delta 必须是非 0 数字`);
          return;
        }
        actions.push({ type: 'item', id, delta: Math.round(rawDelta) });
        return;
      }

      case 'flag': {
        const name = String(entry.name ?? '').trim();
        if (!name) {
          notes.push(`${label}(flag) name 为空，已忽略`);
          return;
        }
        if (name.length > FLAG_MAX_CHARS) {
          notes.push(`${label}(flag) name 过长，已截断`);
        }
        actions.push({ type: 'flag', name: name.slice(0, FLAG_MAX_CHARS) });
        return;
      }

      case 'scene_visual': {
        const key = String(entry.key ?? '').trim();
        if (!ctx.sceneVisualKeys.includes(key)) {
          notes.push(`${label}(scene_visual) key "${key}" 不在本块白名单，已忽略`);
          return;
        }
        actions.push({ type: 'scene_visual', key });
        return;
      }

      case 'transition': {
        const blockId = String(entry.blockId ?? '').trim();
        if (!ctx.allowedTransitions.includes(blockId)) {
          issues.push(
            `${label}(transition) 的 blockId "${blockId}" 不在本场景允许的转场内，只能是：${
              ctx.allowedTransitions.join('、') || '（本场景无转场）'
            }`
          );
          return;
        }
        actions.push({ type: 'transition', blockId });
        return;
      }

      case 'npc_effect': {
        const npc = String(entry.npc ?? '').trim() as NpcId;
        if (!NPC_IDS.includes(npc)) {
          issues.push(
            `${label}(npc_effect) 的 npc "${npc}" 非法，只能是：${NPC_IDS.join('|')}`
          );
          return;
        }
        const rawDelta = Number(entry.delta) || 0;
        const delta = Math.max(-1, Math.min(1, Math.round(rawDelta)));
        if (delta !== Math.round(rawDelta)) {
          notes.push(`${label}(npc_effect) delta ${rawDelta} 越界，已钳制为 ${delta}`);
        }
        const tag = String(entry.tag ?? '').trim();
        actions.push({ type: 'npc_effect', npc, delta, ...(tag ? { tag } : {}) });
        return;
      }
    }
  });

  // 互斥约束：一次只能有一处检定来源
  const diceCount = actions.filter((a) => a.type === 'dice').length;
  const battleCount = actions.filter((a) => a.type === 'battle').length;
  if (diceCount > 0 && battleCount > 0) {
    issues.push('dice 与 battle 不能同时输出，本轮只能选一种检定来源');
  }

  const transitionCount = actions.filter((a) => a.type === 'transition').length;
  if (transitionCount > 1) {
    issues.push('一次只能输出一个 transition 动作');
  }

  let accepted = actions;

  // 软修正：战斗进行中 / 已达上限时，按既有语义静默丢弃 dice 与 battle
  if (issues.length === 0) {
    const chainActive = ctx.combatChain !== null;
    const battleCapped = ctx.battlesThisScene >= ctx.battleLimit;
    if (chainActive || battleCapped) {
      const before = accepted.length;
      accepted = accepted.filter((a) => {
        if (a.type === 'battle') return !chainActive && !battleCapped;
        if (a.type === 'dice') return !chainActive;
        return true;
      });
      if (accepted.length !== before) {
        notes.push(
          chainActive
            ? '战斗链进行中，已忽略本轮 dice/battle 动作'
            : `本场景战斗已达 ${ctx.battleLimit} 场，已忽略本轮 battle 动作`
        );
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, actions: [], issues, notes };
  }
  return { ok: true, actions: accepted, issues, notes };
}

/* ────────── 归并为 applyResponse 消费的响应 ────────── */

/** 把已校验的动作列表编译成 AIResponse（narrative 取思考轮的 reply） */
export function actionsToResponse(actions: readonly DMAction[], reply: string): AIResponse {
  const dice = actions.find((a) => a.type === 'dice');
  const battle = actions.find((a) => a.type === 'battle');
  const transition = actions.find((a) => a.type === 'transition');
  const sceneVisual = actions.find((a) => a.type === 'scene_visual');

  return {
    narrative: reply,
    dice: dice && dice.type === 'dice'
      ? { skill: dice.skill, dc: dice.dc, reason: dice.reason }
      : null,
    battlePrefabId: battle && battle.type === 'battle' ? battle.prefabId : null,
    items: actions.flatMap((a) => (a.type === 'item' ? [{ id: a.id, delta: a.delta }] : [])),
    hp: actions.reduce((sum, a) => (a.type === 'hp' ? sum + a.delta : sum), 0),
    flags: actions.flatMap((a) => (a.type === 'flag' ? [a.name] : [])),
    next: transition && transition.type === 'transition' ? transition.blockId : null,
    sceneVisualId: sceneVisual && sceneVisual.type === 'scene_visual' ? sceneVisual.key : null,
    npcEffects: actions.flatMap((a) =>
      a.type === 'npc_effect' ? [{ npc: a.npc, delta: a.delta, tag: a.tag ?? null }] : []
    ),
  };
}

/** 把实际落地的动作渲染成一行摘要（供反思提示） */
export function formatActionsForReflection(actions: readonly DMAction[]): string {
  if (actions.length === 0) return '（本轮无机器动作，纯叙事回合）';
  return actions.map((a) => JSON.stringify(a)).join('\n');
}
