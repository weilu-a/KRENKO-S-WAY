/**
 * 预制战斗：每场为多轮属性检定（与 StoryBlocks.battlePrefabSlots 对应）
 * 检定名须含：力量|敏捷|体质|智力|感知|魅力
 */

export interface BattleRoundTemplate {
  attribute: string;
  dc: number;
  reason: string;
}

export interface BattlePrefabDef {
  id: string;
  title: string;
  rounds: BattleRoundTemplate[];
}

export const BATTLE_PREFABS: Record<string, BattlePrefabDef> = {
  slot_block04_a: {
    id: 'slot_block04_a',
    title: '下水道·巡逻遭遇',
    rounds: [
      { attribute: '感知', dc: 12, reason: '察觉远处水声与沉重脚步' },
      { attribute: '敏捷', dc: 14, reason: '在湿滑走道上抢先占位或闪开' },
      { attribute: '力量', dc: 15, reason: '与刻洛战士角力或击退' },
    ],
  },

  slot_block05_a: {
    id: 'slot_block05_a',
    title: '锡街·骚帮耳目',
    rounds: [
      { attribute: '感知', dc: 13, reason: '发现被人尾随' },
      { attribute: '魅力', dc: 14, reason: '唬骗或威吓摆脱盯梢' },
      { attribute: '敏捷', dc: 12, reason: '钻入人群甩开追踪' },
    ],
  },
  slot_block05_b: {
    id: 'slot_block05_b',
    title: '锡街·集场冲突',
    rounds: [
      { attribute: '魅力', dc: 12, reason: '在推搡中稳住场面' },
      { attribute: '体质', dc: 14, reason: '扛住冲撞与推挤' },
      { attribute: '力量', dc: 13, reason: '格挡或反制挑衅者' },
    ],
  },

  slot_block06_a: {
    id: 'slot_block06_a',
    title: '锻炉街·欢迎派对',
    rounds: [
      { attribute: '魅力', dc: 11, reason: '喝退敌意谩骂的帮众' },
      { attribute: '力量', dc: 14, reason: '击退第一波推搡与挥击' },
      { attribute: '体质', dc: 13, reason: '扛住混乱中的撞击' },
    ],
  },
  slot_block06_b: {
    id: 'slot_block06_b',
    title: '锻炉街·帮派混战',
    rounds: [
      { attribute: '敏捷', dc: 14, reason: '在狭窄巷道闪避棍棒' },
      { attribute: '力量', dc: 15, reason: '突破包围或击倒一人' },
      { attribute: '感知', dc: 12, reason: '察觉增援或撤退时机' },
    ],
  },

  slot_block07_a: {
    id: 'slot_block07_a',
    title: '藏身处·外围潜入',
    rounds: [
      { attribute: '敏捷', dc: 14, reason: '趁换班间隙贴近仓门' },
      { attribute: '智力', dc: 12, reason: '记住巡逻节奏与哨位' },
      { attribute: '感知', dc: 13, reason: '察觉门旁绊索或窥孔' },
    ],
  },
  slot_block07_b: {
    id: 'slot_block07_b',
    title: '藏身处·仓内突破',
    rounds: [
      { attribute: '力量', dc: 15, reason: '撬开或撞开侧门/铁链' },
      { attribute: '敏捷', dc: 13, reason: '沿台道通过脆弱台阶' },
      { attribute: '感知', dc: 14, reason: '在昏暗中辨认伏兵与陷阱' },
    ],
  },

  slot_block08_a: {
    id: 'slot_block08_a',
    title: '直面克仑可·交锋',
    rounds: [
      { attribute: '魅力', dc: 16, reason: '对峙中压制克仑可气焰或拖延' },
      { attribute: '敏捷', dc: 14, reason: '躲开鬼怪头目的夹击' },
      { attribute: '力量', dc: 15, reason: '与克仑可正面换伤或格挡' },
    ],
  },
  slot_block08_b: {
    id: 'slot_block08_b',
    title: '直面克仑可·终局',
    rounds: [
      { attribute: '体质', dc: 15, reason: '扛住毒素与挥砍的叠加压力' },
      { attribute: '智力', dc: 13, reason: '判断其逃跑路线与弱点' },
      { attribute: '力量', dc: 16, reason: '最后一击制服或击倒' },
    ],
  },
};

export type SceneBattleSlots = readonly [string | null, string | null];

/** 供 AI 提示：本块可用的 battlePrefabId 列表 */
export function formatBattleSlotHint(slots: SceneBattleSlots): string {
  const parts = [slots[0], slots[1]].filter(Boolean) as string[];
  if (parts.length === 0) return '（本场景无预制战斗槽）';
  return parts.map((id) => `${id}（${BATTLE_PREFABS[id]?.title ?? id}）`).join('；');
}
