/**
 * 玩家运行时状态
 */

import { PLAYER } from './Player';
import { ITEMS_BY_ID, type ItemDef } from './Items';

/** 背包物品 */
export interface BackpackItem {
  id: string;
  qty: number;
}

/** 背包最大容量（不同 id 的物品种类数） */
export const BACKPACK_MAX = 8;

/** 起始：基础装备穿在身上 + 少量补给 */
const START_EQUIPPED: string[] = ['eq_chain_mail', 'eq_shield', 'eq_longsword'];

const START_BACKPACK: BackpackItem[] = [
  { id: 'con_healing_salve', qty: 1 },
  { id: 'con_rations', qty: 2 },
];

/** 当前玩家运行时状态 */
export const playerState = {
  hp: PLAYER.hpMax,
  tempHp: 0,
  /** 已装备物品 id（仅 equipment 类应放入） */
  equippedIds: [...START_EQUIPPED] as string[],
  backpack: [...START_BACKPACK] as BackpackItem[],
  /** 当前剧情块内已触发战斗次数（进入新块时归零） */
  battlesThisScene: 0,
};

export function resetCombatState(): void {
  /* 无职业能力可重置 */
}

export function resetSceneState(): void {
  playerState.battlesThisScene = 0;
}

export function resetHp(): void {
  playerState.hp = PLAYER.hpMax;
}

/** 进入新剧情块时调用 */
export function resetSceneBattleCount(): void {
  playerState.battlesThisScene = 0;
}

export function incrementSceneBattleCount(): void {
  playerState.battlesThisScene += 1;
}

/** 重置为开局（新游戏） */
export function resetPlayerState(): void {
  playerState.hp = PLAYER.hpMax;
  playerState.tempHp = 0;
  playerState.equippedIds = [...START_EQUIPPED];
  playerState.backpack = START_BACKPACK.map((i) => ({ ...i }));
  playerState.battlesThisScene = 0;
}

/** 添加物品到背包 */
export function addItem(id: string, qty: number = 1): void {
  const def = ITEMS_BY_ID[id];
  if (def?.kind === 'equipment') {
    console.warn('[PlayerState] 装备请用 equipFromBackpack，不从 addItem 堆叠');
  }
  const existing = playerState.backpack.find((i) => i.id === id);
  if (existing) {
    existing.qty += qty;
  } else {
    playerState.backpack.push({ id, qty });
  }
}

/** 从背包移除物品 */
export function removeItem(id: string, qty: number = 1): void {
  const existing = playerState.backpack.find((i) => i.id === id);
  if (!existing) return;
  existing.qty -= qty;
  if (existing.qty <= 0) {
    playerState.backpack = playerState.backpack.filter((i) => i.id !== id);
  }
}

export function hasItem(id: string): boolean {
  return playerState.backpack.some((i) => i.id === id && i.qty > 0);
}

export function isBackpackFull(): boolean {
  return playerState.backpack.length >= BACKPACK_MAX;
}

export function isBackpackOverflow(): boolean {
  return playerState.backpack.length > BACKPACK_MAX;
}

/** 使用消耗品回复 HP（移除 1 件） */
export function consumeHealingItem(id: string): { ok: boolean; healed: number; def?: ItemDef } {
  const def = ITEMS_BY_ID[id];
  if (!def || def.kind !== 'consumable' || !def.healHp || def.healHp <= 0) {
    return { ok: false, healed: 0 };
  }
  if (!hasItem(id)) return { ok: false, healed: 0 };
  removeItem(id, 1);
  return { ok: true, healed: def.healHp, def };
}

/** 装备（从背包移除并放入装备槽；若已满则返回 false） */
export function equipFromBackpack(id: string): boolean {
  const def = ITEMS_BY_ID[id];
  if (!def || def.kind !== 'equipment') return false;
  if (!hasItem(id)) return false;
  if (playerState.equippedIds.length >= 5) return false;
  removeItem(id, 1);
  playerState.equippedIds.push(id);
  return true;
}

export function getBackpackSummary(): string {
  if (playerState.backpack.length === 0) return '空';
  return playerState.backpack
    .map((i) => {
      const def = ITEMS_BY_ID[i.id];
      const name = def?.name ?? i.id;
      return i.qty > 1 ? `${name}×${i.qty}` : name;
    })
    .join('、');
}

export function getEquippedSummary(): string {
  if (playerState.equippedIds.length === 0) return '无';
  return playerState.equippedIds
    .map((id) => ITEMS_BY_ID[id]?.name ?? id)
    .join('、');
}

export function resetBackpack(): void {
  playerState.backpack = START_BACKPACK.map((i) => ({ ...i }));
  playerState.equippedIds = [...START_EQUIPPED];
}
