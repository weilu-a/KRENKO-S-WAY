/**
 * 场景立绘（背景图）与剧情块 / 子场景键对应。
 * 资源放在 Vite publicDir：`assets/backgrounds/`（见该目录 README）。
 */

import { STORY_BLOCKS } from './StoryBlocks';

function getBase(): string {
  return (import.meta as unknown as { env: { BASE_URL?: string } }).env?.BASE_URL ?? '';
}

/** 模组内全部剧情块 ID（与 STORY_BLOCKS 同步） */
export const STORY_BLOCK_IDS = Object.keys(STORY_BLOCKS).sort((a, b) =>
  a.localeCompare(b, undefined, { numeric: true })
);

/**
 * 同一剧情块内可切换的子场景立绘键（文件名不含扩展名）。
 * 未列出的块：仅使用 `blockId` 一张图。
 */
export const SCENE_VISUAL_KEYS_BY_BLOCK: Record<string, readonly string[]> = {
  /** 锡街：集场 / 磨石酒馆 / 法莉什工坊 */
  BLOCK_05: ['BLOCK_05', 'BLOCK_05_tavern', 'BLOCK_05_falish_workshop'],
};

export function getSceneVisualKeysForBlock(blockId: string): readonly string[] {
  return SCENE_VISUAL_KEYS_BY_BLOCK[blockId] ?? [];
}

/** 进入剧情块时的默认立绘键（子场景块取列表首项，否则为 blockId） */
export function getDefaultSceneVisualKey(blockId: string): string {
  const keys = getSceneVisualKeysForBlock(blockId);
  return keys.length > 0 ? keys[0]! : blockId;
}

/**
 * 校验 AI 返回的 sceneVisualId 是否可用于当前块；合法则返回该键，否则 null（不切换）。
 */
export function resolveSceneVisualKey(
  blockId: string,
  requested: string | null | undefined
): string | null {
  if (requested == null) return null;
  const trimmed = String(requested).trim();
  if (trimmed === '' || trimmed === 'null') return null;
  const allowed = getSceneVisualKeysForBlock(blockId);
  if (allowed.length === 0) return null;
  return allowed.includes(trimmed) ? trimmed : null;
}

/** 写入系统提示：锡街子场景说明（与 shouldApplySceneVisual 规则一致） */
export function formatSceneVisualHintForPrompt(blockId: string): string {
  const keys = getSceneVisualKeysForBlock(blockId);
  if (keys.length === 0) return '';
  return `【场景立绘·子场景】仅在叙事**已发生对应空间位移**时设置 sceneVisualId（仅可填：${keys.join('、')}）；无位移填 null。
- BLOCK_05：锡街集场/大道（户外）
- BLOCK_05_tavern：已进入**磨石酒馆室内**（吧台、店内），非门口驻足
- BLOCK_05_falish_workshop：已进入**法莉什工坊室内**（提灯照亮房间、室内陈设可见）；**禁止**在仅描述后巷、小铁门、撬锁、赤铜门、刻文陷阱、门外检定时尚未进入房间时填写——须等叙事写到进入室内后再填；从工坊离开回到街道时改回 BLOCK_05
【引擎】若违反上述时序，sceneVisualId 会被忽略。`;
}

/**
 * 是否应用 AI 给出的 sceneVisualId（防止「未进门先切室内立绘」）。
 * @param currentVisualKey 当前 gameProgress.sceneVisualKey
 */
export function shouldApplySceneVisual(
  blockId: string,
  sceneKey: string,
  narrative: string,
  currentVisualKey: string
): boolean {
  if (blockId !== 'BLOCK_05') return true;
  const n = narrative;

  if (sceneKey === 'BLOCK_05') {
    return true;
  }

  if (sceneKey === 'BLOCK_05_falish_workshop') {
    if (currentVisualKey === 'BLOCK_05_falish_workshop') {
      return true;
    }
    const enteredWorkshop =
      /室内|房间内|屋里|工坊内|进入.*房间|进入.*工坊|门后.*(?:看到|一片)|提灯.*照亮|杂乱.*房间|长三十尺|三十尺.*二十尺|墙.*挂.*武器|炼金|工作台.*工具|推开门.*(?:后|，)|门.*(?:敞开|打开).*(?:光|房间|室内|一片)|走下.*楼梯.*(?:尽头|之后|梯后)/.test(
        n
      );
    const onlyAtDoorOrAlley =
      /撬锁|挂锁|小铁门|赤铜门|窥孔|刻文|陷阱|glyph|保险库.*门|餐厅.*后巷|后巷.*小铁门|尚未进入|还没打开|门仍锁|对着.*门|端详.*锁/.test(
        n
      ) && !enteredWorkshop;
    if (onlyAtDoorOrAlley) return false;
    return enteredWorkshop;
  }

  if (sceneKey === 'BLOCK_05_tavern') {
    if (currentVisualKey === 'BLOCK_05_tavern') {
      return true;
    }
    const inTavern =
      /店内|吧台|酒馆.*(?:内|里)|走进.*酒馆|步入.*酒馆|磨石.*(?:内|里)|室内.*酒|推.*酒馆.*门.*(?:后|，)/.test(n);
    const onlyOutsideTavern =
      /酒馆.*(?:门口|外)(?!.*进)|站在.*酒馆.*门(?!.*内)/.test(n) && !inTavern;
    if (onlyOutsideTavern) return false;
    return inTavern || !/(酒馆|磨石)/.test(n);
  }

  return true;
}

/**
 * 按优先级返回要尝试加载的 URL（先专属图，再全局兜底）。
 * `sceneKey` 可为 BLOCK_XX 或 BLOCK_05_tavern 等子键。
 */
export function getSceneBackgroundCandidates(sceneKey: string): string[] {
  const base = getBase();
  const id = sceneKey.trim();
  return [
    `${base}backgrounds/${id}.png`,
    `${base}backgrounds/${id}.jpg`,
    `${base}backgrounds/${id}.jpeg`,
    `${base}backgrounds/${id}.webp`,
    `${base}background.png`,
    `${base}f__tx_study_week2_day5_2d_game_template_image.png`,
  ];
}
