/**
 * ReAct 三个阶段的任务提示词：思考轮（reason）/ 行为轮（act）/ 反思轮（reflect）。
 *
 * 世界观、模组规则、状态快照、白名单在 system 消息里（AIDirector.buildSystemPrompt）；
 * 这里只负责「本阶段要模型做什么、输出什么形状」。
 */

import { formatActionCatalog, formatActionConstraints } from './ActionRegistry';
import type { ReActContext, RoundInput } from './ReActTypes';

/** 上一轮失败时的回灌材料：非法原文 + 具体错误 */
export interface PhaseFeedback {
  /** 上一轮该阶段的原始输出（原样回灌） */
  raw: string;
  /** 校验/传输错误说明 */
  issues: string[];
}

/** 渲染最近对话历史（由 blockTranscript 提供） */
export function renderTranscript(
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; text: string }>,
  maxChars = 2400
): string {
  if (messages.length === 0) return '';
  const lines = messages.map((m) => `${m.role === 'user' ? '玩家' : 'DM'}：${m.text}`);
  // 从最新往回取，直到超出预算
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (used + line.length > maxChars && kept.length > 0) break;
    kept.unshift(line);
    used += line.length;
  }
  return kept.join('\n');
}

/** 行为轮/思考轮重试时的回灌段 */
function formatFeedback(feedback: PhaseFeedback | undefined): string {
  if (!feedback) return '';
  return `
【上一次尝试无效，请修正】你上一轮的原始输出是：
---
${feedback.raw.trim().slice(0, 1200)}
---
它存在以下问题：
${feedback.issues.map((i) => `- ${i}`).join('\n')}
请直接输出修正后的 JSON，不要解释、不要道歉、不要重复上述错误。`;
}

/** 把本轮触发事件写成一段描述（反思提示也复用） */
export function describeRoundInput(input: RoundInput): string {
  if (input.kind === 'player') {
    return `玩家刚刚说：「${input.text}」`;
  }
  const { check, rawRoll, modifier, total, success } = input;
  const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
  return `玩家掷出了检定：【${check.skill}检定】骰面 ${rawRoll} ${modStr} = 总计 ${total}（DC ${check.dc}）→ ${
    success ? '✓ 成功' : '✗ 失败'
  }
该检定的原因：${check.reason}`;
}

/* ────────── ① 思考轮 ────────── */

export function buildReasonInstruction(
  ctx: ReActContext,
  input: RoundInput,
  feedback?: PhaseFeedback
): string {
  const history = ctx.history
    ? `【最近对话】（越靠后越新）\n${ctx.history}`
    : '【最近对话】（本场景尚无对话）';
  const reflection = ctx.lastReflection
    ? `【你上一轮的静默反思】\n${ctx.lastReflection}`
    : '【你上一轮的静默反思】（无，本轮是你在这个场景的第一轮）';
  const diceExtra =
    input.kind === 'dice'
      ? '\n本次检定的成败已经由骰子决定，你必须接受该结果：成功给出玩家争取到的东西，失败按失败方向推进但不要阻断主线，也不要否定玩家此前的努力。'
      : '';

  return `${history}

${reflection}

【本轮触发】${describeRoundInput(input)}${diceExtra}

【思考轮任务】
先想清楚，再回复玩家。严格输出 JSON（不要代码块包裹）：
{"thought":"内部思考","reply":"给玩家的中文回复"}

- thought：用自然中文写清你作为 DM 的判断 —— 玩家想做什么、本场景的线索/规则/NPC 关系如何约束、这个世界会如何回应、本轮是否需要检定或场景位移、要避免什么。这是你指导后续行为的依据，玩家看不到。
- reply：直接呈现给玩家的中文回复，2~4 句，只写玩家此刻能感知到的内容。

reply 的硬性规则：
1. 若本轮需要玩家掷骰，reply 必须停在「不确定时刻」（描述处境与要面对的风险），禁止先写出成功/失败的结果。
2. 若玩家本轮明显要动身前往新地点，reply 只写到离场动作或一句收束，不要展开目的地的细节（新场景正文由引擎朗读念白承接）。
3. 不要写「场景转换」这类分隔线，不要复述念白全文。
4. 不编造模组外的 NPC/地点；不替玩家决定其行动与感受。
5. 引用前序剧情摘要时，只使用摘要中确实出现过的事实。
${formatFeedback(feedback)}`;
}

/* ────────── ② 行为轮 ────────── */

export function buildActInstruction(
  ctx: ReActContext,
  thought: string,
  reply: string,
  feedback?: PhaseFeedback
): string {
  return `【你的内部思考】
${thought}

【你已对玩家说出的回复（原文，不得改口、不得新增叙事）】
${reply || '（本轮你选择不向玩家输出正文，通常是即将转场的情形）'}

【行为轮任务】
把上面这段回复所隐含的、机器可执行的效果，输出为动作列表。严格输出 JSON（不要代码块包裹）：
{"actions":[ ... ]}

${formatActionCatalog()}

${formatActionConstraints(ctx)}

规则：
- 本阶段不再写叙事。actions 必须与上述回复完全一致，禁止临场加戏或改口。
- 若回复里出现了检定、转场、物品增减、HP 变化、关系变化、子场景位移等效果，必须在此输出对应动作；确实没有则 actions 为空数组。
- hp 填「变化量」而不是当前值；没有变化就不要输出该动作。
- 不要臆造玩家没有做出的行动。若回复未承诺任何效果，就不要为了让回合"有事发生"而硬造动作。
${formatFeedback(feedback)}`;
}

/* ────────── ③ 静默反思 ────────── */

export interface ReflectionInput {
  /** 本轮触发描述 */
  trigger: string;
  thought: string;
  reply: string;
  /** 实际落地的动作摘要 */
  appliedActions: string;
  /** 引擎的观察：软修正、被丢弃的动作等 */
  engineNotes: string;
  /** 落地后的状态变化摘要（HP/物品/关系/转场等） */
  stateChanges: string;
}

export function buildReflectInstruction(ctx: ReActContext, data: ReflectionInput): string {
  return `（静默自省，玩家看不到这段对话）

【本回合记录｜场景 ${ctx.blockId} ${ctx.blockName}】
触发：${data.trigger}
你的思考：${data.thought || '（无）'}
你对玩家说的话：${data.reply || '（无正文）'}
实际执行的动作：
${data.appliedActions}
引擎的观察与修正：${data.engineNotes || '（无）'}
落地后的状态变化：${data.stateChanges || '（无）'}

【反思任务】严格输出 JSON（不要代码块包裹）：
{"reflection":"反思正文","nextFocus":["下轮要点"]}

- reflection：3~5 句中文自省，写清：玩家的真实意图是什么、本轮世界如何回应、是否有前后矛盾、是否有对玩家的承诺尚未兑现、逻辑是否与模组约束（线索链、关系、战斗上限）一致、叙事节奏是否合适。
- nextFocus：1~3 条下轮必须记住的短要点（例如未兑现的承诺、待触发的伏笔、NPC 关系的走向、玩家尚未察觉的线索）。
- 只做自我评估，不要续写剧情，不要给玩家安排新剧情。`;
}
