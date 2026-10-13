/**
 * AI DM 导演系统
 * 负责：构建 prompt → 驱动 ReAct 循环（思考/行为/反思）→ 执行副作用（HP/背包/骰子/转场）
 * 严格遵循 story_blocks.md 的剧情分块与事件表
 *
 * 一轮对话 = ReActLoop.runRound（思考轮 → 行为轮 → 引擎校验 → 回灌重试）→ applyResponse 落地
 * → 静默反思（注入下一轮思考）。见 ./react/。
 */

import { isLLMInitialized, generateContent } from '../../ai/LLMClient';
import { STORY_BLOCKS, getCheckModifier, type StoryBlock } from '../data/StoryBlocks';
import { gameProgress, type NpcId } from '../data/GameProgress';
import {
  getDefaultSceneVisualKey,
  getSceneVisualKeysForBlock,
  resolveSceneVisualKey,
  formatSceneVisualHintForPrompt,
  shouldApplySceneVisual,
} from '../data/SceneBackgrounds';
import { ReActLoop } from './react/ReActLoop';
import { formatActionsForReflection } from './react/ActionRegistry';
import { describeRoundInput, renderTranscript } from './react/Prompts';
import type {
  AIResponse,
  DiceCheckInfo,
  ReActContext,
  RoundInput,
} from './react/ReActTypes';
import {
  PLAYER,
  getEffectiveAc,
  getEffectiveAttackBonus,
  getWeaponDamageText,
} from '../data/Player';
import {
  playerState,
  addItem,
  removeItem,
  getBackpackSummary,
  getEquippedSummary,
  isBackpackOverflow,
  BACKPACK_MAX,
  resetSceneBattleCount,
  incrementSceneBattleCount,
} from '../data/PlayerState';
import { ITEMS_BY_ID } from '../data/Items';
import { BATTLE_PREFABS, formatBattleSlotHint } from '../data/BattlePrefabs';

/* ────────── 类型定义（契约见 ./react/ReActTypes） ────────── */

export type { AIResponse, DiceCheckInfo } from './react/ReActTypes';

export interface AICallbacks {
  /** 在对话框中追加消息 */
  onNarrate: (text: string, from: 'dm' | 'player' | 'system') => void;
  /** 角色状态发生变化，刷新面板 */
  onStateChange: () => void;
  /** AI 正在处理中 */
  onProcessing: (busy: boolean) => void;
  /** 需要骰子检定（高亮骰子区域） */
  onDiceRequired: (info: DiceCheckInfo) => void;
  /** 骰子检定完成 */
  onDiceResolved: () => void;
  /** 进入新剧情块时（用于切换场景立绘/背景等） */
  onBlockEntered?: (blockId: string) => void;
  /** 同块内子场景立绘切换（如锡街→酒馆） */
  onSceneVisualChange?: (sceneVisualKey: string) => void;
}

/* ────────── AIDirector ────────── */

export class AIDirector {
  /** 本场景内最多保留的「单条消息」数（玩家+DM 各算一条），用于切块时摘要 */
  private static readonly MAX_TRANSCRIPT_MSGS = 50;
  /** 本场景内最多触发的预制战斗场次 */
  private static readonly MAX_BATTLES_PER_SCENE = 2;
  /** 注入提示词的最近对话条数（玩家+DM 各算一条） */
  private static readonly HISTORY_MSGS = 12;

  private callbacks: AICallbacks;
  private pendingDice: DiceCheckInfo | null = null;
  private isProcessing = false;
  private currentBlock: StoryBlock | null = null;
  private pendingDiscard = false;
  /** 多轮战斗检定链（来自预制） */
  private combatChain: DiceCheckInfo[] | null = null;
  private combatChainIndex = 0;
  /** 当前剧情块内的对话摘录（离开块时取最后至多 50 条做摘要；同时充当 ReAct 的最近历史） */
  private blockTranscript: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  /** ReAct 循环：思考轮 / 行为轮 / 静默反思 */
  private loop = new ReActLoop();

  constructor(callbacks: AICallbacks) {
    this.callbacks = callbacks;
  }

  /* ── 进入新剧情块 ── */

  async enterBlock(blockId: string): Promise<void> {
    const block = STORY_BLOCKS[blockId];
    if (!block) {
      this.callbacks.onNarrate(`（系统：未找到剧情块 ${blockId}）`, 'system');
      return;
    }

    const leavingId = this.currentBlock?.id ?? null;
    const leavingTranscript =
      leavingId && leavingId !== blockId
        ? this.blockTranscript.slice(-AIDirector.MAX_TRANSCRIPT_MSGS)
        : [];
    this.blockTranscript = [];

    this.currentBlock = block;
    gameProgress.currentBlockId = blockId;
    gameProgress.sceneVisualKey = getDefaultSceneVisualKey(blockId);
    gameProgress.visitedBlocks.add(blockId);
    this.pendingDice = null;
    this.combatChain = null;
    this.combatChainIndex = 0;
    resetSceneBattleCount();

    // 清空 ReAct 状态（最近历史走 blockTranscript；前序块由 blockSummaries 承接）
    this.loop.reset();

    this.callbacks.onBlockEntered?.(blockId);

    for (const text of block.readAloud) {
      this.callbacks.onNarrate(text, 'dm');
    }

    // 上一块摘要后台静默生成：不阻塞新场景对话显示
    if (leavingId && leavingId !== blockId && leavingTranscript.length > 0) {
      void this.summarizeAndStoreLeavingBlock(leavingId, leavingTranscript).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        gameProgress.blockSummaries[leavingId] = `（摘要失败：${msg}）`;
      });
    }
  }

  /** 离开剧情块时：把本块最后至多 50 条对话交给模型压缩成摘要，写入 gameProgress */
  private async summarizeAndStoreLeavingBlock(
    blockId: string,
    slice: Array<{ role: 'user' | 'assistant'; text: string }>
  ): Promise<void> {
    if (slice.length === 0) return;
    const dialogue = slice
      .map((m) => `${m.role === 'user' ? '玩家' : 'DM'}：${m.text}`)
      .join('\n');
    const blockName = STORY_BLOCKS[blockId]?.name ?? blockId;
    const prompt = `你是跑团记录员。以下摘录来自模组场景「${blockName}」（${blockId}）中玩家与 DM 的对话。请压缩为简短中文摘要（3～10 条要点，每条一行；保留人名、地点、关键决定与未决事项）。不要编造摘录中没有的内容。\n\n---\n${dialogue}\n---`;

    if (!isLLMInitialized()) {
      gameProgress.blockSummaries[blockId] = '（未生成摘要：AI 未初始化）';
      return;
    }
    const result = await generateContent(prompt);
    if (result.error) {
      gameProgress.blockSummaries[blockId] = `（摘要失败：${result.error}）`;
    } else {
      gameProgress.blockSummaries[blockId] = result.text.trim().slice(0, 4000);
    }
  }

  private recordTranscriptTurn(userText: string, assistantText: string): void {
    const u = userText.trim();
    const a = (assistantText || '').trim() || '（无叙事）';
    this.blockTranscript.push({ role: 'user', text: u });
    while (this.blockTranscript.length > AIDirector.MAX_TRANSCRIPT_MSGS) {
      this.blockTranscript.shift();
    }
    this.blockTranscript.push({ role: 'assistant', text: a });
    while (this.blockTranscript.length > AIDirector.MAX_TRANSCRIPT_MSGS) {
      this.blockTranscript.shift();
    }
  }

  /* ── 处理玩家输入 ── */

  async handlePlayerInput(text: string): Promise<void> {
    if (this.isProcessing) return;
    if (this.pendingDice) {
      this.callbacks.onNarrate('（请先点击骰子完成检定）', 'system');
      return;
    }

    // 背包溢出 → 拦截输入，处理丢弃
    if (this.pendingDiscard) {
      this.handleDiscardInput(text);
      return;
    }

    this.isProcessing = true;
    this.callbacks.onProcessing(true);

    // 显示玩家消息
    this.callbacks.onNarrate(text, 'player');

    if (!isLLMInitialized()) {
      this.callbacks.onNarrate(
        '（AI DM 未初始化：默认方舟请配置 VITE_ARK_API_KEY 与 VITE_ARK_MODEL；使用 Ollama 请设 VITE_LLM_PROVIDER=ollama 并启动 ollama）',
        'system'
      );
      this.isProcessing = false;
      this.callbacks.onProcessing(false);
      return;
    }

    try {
      await this.runRound({ kind: 'player', text });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.callbacks.onNarrate(`（系统错误：${msg}）`, 'system');
    } finally {
      this.isProcessing = false;
      this.callbacks.onProcessing(false);
    }
  }

  /* ── 处理骰子掷出 ── */

  async handleDiceRoll(rawRoll: number): Promise<void> {
    if (!this.pendingDice) return;
    if (this.isProcessing) return;

    this.isProcessing = true;
    const check = this.pendingDice;
    this.pendingDice = null;
    this.callbacks.onDiceResolved();
    this.callbacks.onProcessing(true);

    const modifier = getCheckModifier(playerState.equippedIds, check.skill);
    const total = rawRoll + modifier;
    const success = total >= check.dc;
    const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;

    const resultText = `【${check.skill}检定】🎲 ${rawRoll} ${modStr} = ${total}（DC ${check.dc}）→ ${success ? '✓ 成功' : '✗ 失败'}`;
    this.callbacks.onNarrate(resultText, 'system');

    // 骰子已被消费：无论本轮叙事成败，战斗链都必须推进，否则链会停在中途而无法继续
    const chainAtRoll = this.combatChain;

    if (!isLLMInitialized()) {
      this.callbacks.onNarrate(success ? '（检定成功，但 AI 未初始化无法继续叙事）' : '（检定失败）', 'system');
      this.advanceCombatChainAfterRoll(chainAtRoll);
      this.isProcessing = false;
      this.callbacks.onProcessing(false);
      return;
    }

    try {
      await this.runRound({ kind: 'dice', check, rawRoll, modifier, total, success });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.callbacks.onNarrate(`（系统错误：${msg}）`, 'system');
    } finally {
      this.advanceCombatChainAfterRoll(chainAtRoll);
      this.isProcessing = false;
      this.callbacks.onProcessing(false);
    }
  }

  /* ── 一轮 ReAct：思考 → 行为 → 校验 → 落地 → 静默反思 ── */

  /** 玩家输入与骰子结果共用的回合入口 */
  private async runRound(input: RoundInput): Promise<void> {
    if (!this.currentBlock) return;

    // 每回合重建上下文，保证提示词里的 HP/背包/flags/NPC 是本回合最新值
    const ctx = this.buildReActContext();
    const result = await this.loop.runRound(ctx, input);

    this.recordTranscriptTurn(describeRoundInput(input), result.response.narrative);

    // 降级提示先于叙事播报：system 消息在 MainScene 里是立即显示，dm 消息要入队
    if (result.degraded && result.degradedNotice) {
      this.callbacks.onNarrate(result.degradedNotice, 'system');
    }

    const applied = await this.applyResponse(result.response);

    // 静默反思：转场回合不生成（新场景的记忆由 blockSummaries 承接）
    if (!applied.transitionedTo) {
      this.loop.startReflection(this.buildReActContext(), {
        trigger: describeRoundInput(input),
        thought: result.thought,
        reply: result.response.narrative,
        appliedActions: formatActionsForReflection(result.actions),
        engineNotes: result.notes.join('；'),
        stateChanges: applied.systemLines.join('；'),
      });
    }
  }

  /** 组装 ReAct 上下文（白名单 + 最新系统提示 + 最近历史） */
  private buildReActContext(): ReActContext {
    const block = this.currentBlock;
    const transcript = this.blockTranscript.slice(-AIDirector.HISTORY_MSGS);
    return {
      blockId: block?.id ?? '',
      blockName: block?.name ?? '',
      systemPrompt: block ? this.buildSystemPrompt(block) : '',
      history: renderTranscript(transcript),
      lastReflection: '', // 由 ReActLoop 注入
      allowedTransitions: block ? [...block.transitions] : [],
      battleSlots: block
        ? (block.battlePrefabSlots.filter(Boolean) as string[])
        : [],
      sceneVisualKeys: block ? [...getSceneVisualKeysForBlock(block.id)] : [],
      combatChain: this.combatChain
        ? { index: this.combatChainIndex, total: this.combatChain.length }
        : null,
      battlesThisScene: playerState.battlesThisScene,
      battleLimit: AIDirector.MAX_BATTLES_PER_SCENE,
    };
  }

  /**
   * 多轮预制战斗：本轮掷骰结束后排队下一轮。
   * @param chainAtRoll 掷骰那一刻的链引用；若链已被替换/清空则不推进
   */
  private advanceCombatChainAfterRoll(chainAtRoll: DiceCheckInfo[] | null): void {
    if (!chainAtRoll || this.combatChain !== chainAtRoll) return;
    if (this.combatChainIndex < this.combatChain.length - 1) {
      this.combatChainIndex++;
      this.pendingDice = this.combatChain[this.combatChainIndex];
      const n = this.combatChainIndex + 1;
      const m = this.combatChain.length;
      this.callbacks.onNarrate(
        `【战斗第 ${n}/${m} 轮】${this.pendingDice.reason} —— 请点击骰子进行 ${this.pendingDice.skill} 检定（DC ${this.pendingDice.dc}）`,
        'system'
      );
      this.callbacks.onDiceRequired(this.pendingDice);
    } else {
      this.combatChain = null;
      this.combatChainIndex = 0;
    }
  }

  /** 是否有等待中的骰子检定 */
  hasPendingDice(): boolean {
    return this.pendingDice !== null;
  }

  /** 是否正在处理 */
  isBusy(): boolean {
    return this.isProcessing;
  }

  /* ── 构建系统提示词 ── */

  /** 本场景允许的 next 取值（供模型白名单） */
  /** 已离开场景的剧情摘要，注入系统提示供「回忆」前文 */
  private formatBlockSummariesForPrompt(): string {
    const entries = Object.entries(gameProgress.blockSummaries)
      .filter(([, s]) => s?.trim())
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    if (entries.length === 0) return '';
    return entries
      .map(([id, s]) => {
        const name = STORY_BLOCKS[id]?.name ?? id;
        return `[${id} ${name}]\n${s}`;
      })
      .join('\n\n');
  }

  private formatAllowedNextList(block: StoryBlock): string {
    if (!block.transitions.length) {
      return '（本场景无后续转场）next 必须为 null。';
    }
    return block.transitions
      .map((tid) => {
        const t = STORY_BLOCKS[tid];
        return t ? `${tid} → ${t.name}` : tid;
      })
      .join('\n');
  }

  private buildSystemPrompt(block: StoryBlock): string {
    const hp = playerState.hp;
    const hpMax = PLAYER.hpMax;
    const ac = getEffectiveAc(playerState.equippedIds);
    const atk = getEffectiveAttackBonus(playerState.equippedIds);
    const dmg = getWeaponDamageText();
    const backpack = getBackpackSummary();
    const equipped = getEquippedSummary();
    const flags = gameProgress.flags.size > 0
      ? [...gameProgress.flags].join('、')
      : '无';
    const npcRelations = this.formatNpcRelationsForPrompt();

    const allowedNext = this.formatAllowedNextList(block);
    const battleSlotHint = `【预制战斗槽】最多 2 场/场景；battlePrefabId 只能填下列之一（已含多轮检定）：${formatBattleSlotHint(block.battlePrefabSlots)}`;
    const memoryBlock = this.formatBlockSummariesForPrompt();
    const memorySection = memoryBlock
      ? `【前序剧情摘要】玩家若询问之前经历、已离开场景中的 NPC 或事件，请依据下列摘要作答，可与当前场景信息衔接；不要编造摘要中未出现的事实。\n${memoryBlock}\n`
      : '';
    const sceneVisualSection = formatSceneVisualHintForPrompt(block.id);

    return `你是一位地下城主，主持「追捕克伦克」模组，拉尼卡，单人跑团。
【风格】事件、调查、对话优先；战斗为少数节点，且尽量用预制战斗槽（battle 动作）引用，不要长篇铺陈规则战。
【角色规则】无技能列表、无职业能力；检定只用六项属性名：力量、敏捷、体质、智力、感知、魅力。dice 动作的 skill 必须填其中之一。
【物品】仅两类：装备(加属性/AC/攻击)与消耗品(回复HP)；物品 ID 速查见每轮行为任务中的动作目录。
${memorySection}${sceneVisualSection ? `${sceneVisualSection}\n` : ''}
玩家：Lv.${PLAYER.level} HP${hp}/${hpMax} AC${ac} 攻击+${atk} 伤害${dmg}
装备：${equipped}
背包：${backpack}
已获情报：${flags}
NPC关系：${npcRelations}

【念白摘要（勿复述全文）】${block.readAloudSummaryForAI}

【当前场景】[${block.id}] ${block.name}
${block.context}

${battleSlotHint}
【本场景战斗进度】已触发 ${playerState.battlesThisScene}/${AIDirector.MAX_BATTLES_PER_SCENE} 场；达到上限后不要再开新战斗。

【本场景允许的转场】（transition 动作的 blockId 仅可取此列表中的 ID）
${allowedNext}

【寻获藏身处】若语境中玩家只剩**唯一**一条途径能抵达克仑可藏身处(BLOCK_07)，你必须用检定与叙事**强制**导向该处（可降低 DC、强化线索）；并在玩家明确动身时给出 transition 动作。

模组规则：
- DC 参考场景上下文，不自创无关检定
- 不编造模组外 NPC/地点
- 玩家讨价还价可扮演，但不无故降低 DC
- 关系驱动：当关系<=-1时，该NPC及其关联势力更敌对、线索更难；当关系>=1时，更愿合作，可给捷径或降低一次相关检定DC（幅度轻量）
- 转场仅由玩家**明确动身**触发；提问/闲聊/问路一律不转场

【关于你的输出】你的每次回答都是「思考 → 行为」两步中的一步，两步的 JSON 格式由随后的任务消息规定；本提示只提供世界观、规则与状态，不要在本提示下自行决定输出格式。`;
  }

  private relationLabel(v: number): string {
    if (v <= -2) return '敌对';
    if (v === -1) return '警惕';
    if (v === 0) return '中立';
    if (v === 1) return '信任';
    return '盟友';
  }

  private formatNpcRelationsForPrompt(): string {
    const rows: string[] = [];
    const ids: NpcId[] = ['nassius', 'krenko', 'falish', 'shattergang'];
    for (const id of ids) {
      const st = gameProgress.npcState[id];
      const tags = st.tags.size > 0 ? [...st.tags].join('|') : '无标签';
      rows.push(`${id}:${st.relation}(${this.relationLabel(st.relation)})[${tags}]`);
    }
    return rows.join('；');
  }

  /* ── 执行 AI 响应的副作用 ── */

  /**
   * 落地已校验的响应。
   * @returns systemLines 本回合产生的系统提示文本（供静默反思参考）；transitionedTo 转场目标块
   */
  private async applyResponse(
    response: AIResponse
  ): Promise<{ systemLines: string[]; transitionedTo: string | null }> {
    /** 先处理数值与状态，再决定是否播报 DM 叙事（避免与下一场景 readAloud 重复） */
    const systemBuf: string[] = [];

    // 2. HP 变化（仅在实际数值变化时提示；忽略模型误填的无效增量）
    if (response.hp !== 0) {
      const oldHp = playerState.hp;
      const newHp = Math.max(0, Math.min(PLAYER.hpMax, oldHp + response.hp));
      if (newHp !== oldHp) {
        (playerState as { hp: number }).hp = newHp;
        const delta = newHp - oldHp;
        const hpNote =
          delta > 0
            ? `（恢复了 ${delta} HP，当前 ${playerState.hp}/${PLAYER.hpMax}）`
            : `（受到了 ${Math.abs(delta)} 点伤害，当前 ${playerState.hp}/${PLAYER.hpMax}）`;
        systemBuf.push(hpNote);
        this.callbacks.onStateChange();
      } else {
        console.warn('[AI DM] 忽略无效的 hp 增量（实际 HP 无变化）', response.hp);
      }
    }

    // 3. 物品变动
    if (response.items.length > 0) {
      for (const change of response.items) {
        if (change.delta > 0) {
          addItem(change.id, change.delta);
        } else if (change.delta < 0) {
          removeItem(change.id, Math.abs(change.delta));
        }
      }
      this.callbacks.onStateChange();

      // 背包溢出检查（提示延后到 DM 叙事之后，顺序与原先一致）
      if (isBackpackOverflow()) {
        this.pendingDiscard = true;
        const itemList = playerState.backpack
          .map((i) => {
            const def = ITEMS_BY_ID[i.id];
            const name = def?.name ?? i.id;
            return i.qty > 1 ? `${name}×${i.qty}` : name;
          })
          .join('、');
        systemBuf.push(
          `【背包已满】容量 ${playerState.backpack.length}/${BACKPACK_MAX}，请输入要丢弃的物品名称：\n${itemList}`
        );
      }
    }

    // 4. 进度标记
    for (const flag of response.flags) {
      gameProgress.flags.add(flag);
    }

    // 4a. 关键 NPC 关系变化
    if (response.npcEffects && response.npcEffects.length > 0) {
      for (const effect of response.npcEffects) {
        const npc = effect?.npc;
        if (!npc || !gameProgress.npcState[npc]) continue;
        const oldValue = gameProgress.npcState[npc].relation;
        const deltaRaw = Number(effect.delta) || 0;
        const delta = Math.max(-1, Math.min(1, deltaRaw));
        const newValue = Math.max(-2, Math.min(2, oldValue + delta));
        gameProgress.npcState[npc].relation = newValue;
        if (effect.tag && effect.tag.trim()) {
          gameProgress.npcState[npc].tags.add(effect.tag.trim().slice(0, 40));
        }
        if (newValue !== oldValue) {
          const trend = newValue > oldValue ? '上升' : '下降';
          systemBuf.push(
            `【关系变化】${npc} 关系${trend}：${oldValue}→${newValue}（${this.relationLabel(newValue)}）`
          );
        }
      }
    }

    // 4b. 同块内子场景立绘（如锡街→酒馆/工坊）；工坊须叙事已进门内，见 shouldApplySceneVisual
    if (response.sceneVisualId !== undefined && response.sceneVisualId !== null) {
      const vKey = resolveSceneVisualKey(
        gameProgress.currentBlockId,
        response.sceneVisualId
      );
      if (vKey !== null) {
        const narrative = response.narrative ?? '';
        if (
          shouldApplySceneVisual(
            gameProgress.currentBlockId,
            vKey,
            narrative,
            gameProgress.sceneVisualKey
          )
        ) {
          gameProgress.sceneVisualKey = vKey;
          this.callbacks.onSceneVisualChange?.(vKey);
        } else {
          console.warn(
            '[AI DM] 已忽略 sceneVisualId（叙事位置与立绘不一致）:',
            vKey
          );
        }
      }
    }

    // 5. 骰子：多轮战斗进行中则忽略 AI 顺带返回的 dice，避免打断链表
    const prefabId = response.battlePrefabId;
    const prefab =
      prefabId && BATTLE_PREFABS[prefabId] ? BATTLE_PREFABS[prefabId] : null;
    const chainHasMore =
      this.combatChain !== null &&
      this.combatChainIndex < this.combatChain.length - 1;

    if (!chainHasMore) {
      if (prefab?.rounds?.length && playerState.battlesThisScene < AIDirector.MAX_BATTLES_PER_SCENE) {
        this.tryStartCombatChain(prefabId!, systemBuf);
      } else if (response.dice) {
        this.pendingDice = response.dice;
        systemBuf.push(
          `【需要检定】${response.dice.reason} —— 请点击骰子进行 ${response.dice.skill} 检定（DC ${response.dice.dc}）`
        );
        this.callbacks.onDiceRequired(response.dice);
      }
    }

    const nextId = response.next;
    const allowed =
      nextId &&
      STORY_BLOCKS[nextId] &&
      this.currentBlock !== null &&
      this.currentBlock.transitions.includes(nextId);

    const willTransition =
      !!nextId &&
      !!STORY_BLOCKS[nextId!] &&
      !this.pendingDiscard &&
      !this.pendingDice &&
      allowed;

    /** 即将进入的新块有预制念白时，不再播报本轮 AI narrative，避免与 readAloud 重复 */
    const suppressDmForReadAloud =
      willTransition && (STORY_BLOCKS[nextId!].readAloud?.length ?? 0) > 0;

    if (response.narrative && !suppressDmForReadAloud) {
      this.callbacks.onNarrate(response.narrative, 'dm');
    }
    for (const line of systemBuf) {
      this.callbacks.onNarrate(line, 'system');
    }

    // 6. 场景转换：next 必须属于当前块的 transitions；有未决检定时不转场
    let transitionedTo: string | null = null;
    if (willTransition && nextId) {
      this.callbacks.onNarrate('─── 场景转换 ───', 'system');
      await this.enterBlock(nextId);
      transitionedTo = nextId;
    } else if (response.next && !allowed) {
      console.warn(
        '[AI DM] 忽略非法转场 next=',
        response.next,
        '当前允许:',
        this.currentBlock?.transitions
      );
    }

    return { systemLines: systemBuf, transitionedTo };
  }

  /* ── 背包丢弃流程 ── */

  /** 提示玩家丢弃物品 */
  private promptDiscard(): void {
    this.pendingDiscard = true;
    const itemList = playerState.backpack
      .map((i) => {
        const def = ITEMS_BY_ID[i.id];
        const name = def?.name ?? i.id;
        return i.qty > 1 ? `${name}×${i.qty}` : name;
      })
      .join('、');
    this.callbacks.onNarrate(
      `【背包已满】容量 ${playerState.backpack.length}/${BACKPACK_MAX}，请输入要丢弃的物品名称：\n${itemList}`,
      'system'
    );
  }

  /** 处理丢弃输入：匹配玩家文本中的物品名并移除 */
  private handleDiscardInput(text: string): void {
    this.callbacks.onNarrate(text, 'player');

    const input = text.trim();
    let matchedId: string | null = null;
    let matchedName = '';

    // 遍历背包物品，模糊匹配（玩家输入包含物品名，或物品名包含玩家输入）
    for (const item of playerState.backpack) {
      const def = ITEMS_BY_ID[item.id];
      const name = def?.name ?? item.id;
      if (input.includes(name) || name.includes(input) || input.includes(item.id)) {
        matchedId = item.id;
        matchedName = name;
        break;
      }
    }

    if (!matchedId) {
      this.callbacks.onNarrate('（未找到该物品，请输入背包中的物品名称）', 'system');
      return;
    }

    removeItem(matchedId, 1);
    this.callbacks.onNarrate(`你丢弃了「${matchedName}」。`, 'system');
    this.callbacks.onStateChange();

    // 还溢出？继续要求丢弃
    if (isBackpackOverflow()) {
      this.promptDiscard();
    } else {
      this.pendingDiscard = false;
      this.callbacks.onNarrate(`背包整理完毕（${playerState.backpack.length}/${BACKPACK_MAX}），继续冒险吧。`, 'system');
    }
  }

  /** 是否正在等待丢弃 */
  hasPendingDiscard(): boolean {
    return this.pendingDiscard;
  }

  /** 启动预制战斗链（本场景最多 2 场） */
  private tryStartCombatChain(prefabId: string, systemBuf: string[]): void {
    if (playerState.battlesThisScene >= AIDirector.MAX_BATTLES_PER_SCENE) {
      console.warn('[AIDirector] 本场景战斗已达 2 场上限，忽略 battlePrefabId', prefabId);
      return;
    }
    const p = BATTLE_PREFABS[prefabId];
    if (!p?.rounds?.length) return;
    incrementSceneBattleCount();
    this.combatChain = p.rounds.map((r) => ({
      skill: r.attribute,
      dc: r.dc,
      reason: `${p.title}：${r.reason}`,
    }));
    this.combatChainIndex = 0;
    this.pendingDice = this.combatChain[0];
    systemBuf.push(
      `【战斗】${p.title} 第 1/${this.combatChain.length} 轮 —— 请点击骰子进行 ${this.pendingDice.skill} 检定（DC ${this.pendingDice.dc}）`
    );
    this.callbacks.onDiceRequired(this.pendingDice);
  }
}
