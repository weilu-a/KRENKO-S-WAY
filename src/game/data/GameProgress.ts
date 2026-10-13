/**
 * 全局游戏进度 - 跨剧情块持久化的状态
 * 剧情块摘要：离开某块时由 AI 压缩本块对话，供后续系统提示「回忆」前文
 */

import { resetPlayerState } from './PlayerState';

export type NpcId = 'nassius' | 'krenko' | 'falish' | 'shattergang';

export interface NpcRelationState {
  /** 关系值范围 -2~2 */
  relation: number;
  /** 轻量标签（如 owed_favor、betrayed） */
  tags: Set<string>;
}

export type NpcState = Record<NpcId, NpcRelationState>;

function createDefaultNpcState(): NpcState {
  return {
    nassius: { relation: 0, tags: new Set<string>() },
    krenko: { relation: 0, tags: new Set<string>() },
    falish: { relation: 0, tags: new Set<string>() },
    shattergang: { relation: 0, tags: new Set<string>() },
  };
}

export const gameProgress = {
  /** 当前剧情块 ID */
  currentBlockId: 'BLOCK_00',
  /**
   * 当前用于加载立绘的键（通常等于剧情块 ID；部分块可有子场景，如锡街酒馆/工坊）
   * @see SceneBackgrounds
   */
  sceneVisualKey: 'BLOCK_00',
  /** 已访问过的块 */
  visitedBlocks: new Set<string>(),
  /** 进度标记（情报、事件触发等） */
  flags: new Set<string>(),
  /** 已离开的剧情块 ID → 该块对话的简短摘要（中文） */
  blockSummaries: {} as Record<string, string>,
  /** 关键 NPC 关系状态（轻量分支核心） */
  npcState: createDefaultNpcState(),
};

/** 重置全部进度（重新开始游戏） */
export function resetProgress(): void {
  gameProgress.currentBlockId = 'BLOCK_00';
  gameProgress.sceneVisualKey = 'BLOCK_00';
  gameProgress.visitedBlocks.clear();
  gameProgress.flags.clear();
  gameProgress.blockSummaries = {};
  gameProgress.npcState = createDefaultNpcState();
  resetPlayerState();
}
