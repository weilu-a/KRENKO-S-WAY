/**
 * Main Scene - 追捕克伦克：单人单角色 + AI DM 跑团
 * 固定 1280×720 游戏区；左侧对话框 + 右侧骰子；底部栏左侧为角色/背包等信息、中间输入框、右侧可前往区域。
 */

import { Assets, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { Engine, GameScene } from '../engine/Engine';
import { World } from '../engine/World';
import {
  PLAYER,
  getEffectiveAc,
  getEffectiveAttackBonus,
  getWeaponDamageText,
} from './data/Player';
import { playerState, getEquippedSummary } from './data/PlayerState';
import { ITEMS_BY_ID } from './data/Items';
import { gameProgress } from './data/GameProgress';
import { getExitDestinationNames } from './data/StoryBlocks';
import { getSceneBackgroundCandidates } from './data/SceneBackgrounds';
import { AIDirector, type DiceCheckInfo } from './systems/AIDirector';

const getBase = () => (import.meta as unknown as { env: { BASE_URL?: string } }).env?.BASE_URL ?? '';

// 这里只用三个骰子图片（可在 assets/dices 中替换）
const DICE_IMAGE_NAMES = ['d20', 'd6', 'd10'];

/** 玩家输入框最大字符数（含换行） */
const INPUT_MAX_CHARS = 500;

export class MainScene implements GameScene {
  public world: World;

  private engine: Engine;
  private gameWidth: number;
  private gameHeight: number;
  private backgroundContainer: Container;
  /** 裁切游戏区用的全屏遮罩（只创建一次） */
  private backgroundMaskGraphics: Graphics | null = null;
  private container: Container;
  private uiContainer: Container;

  // 对话框相关
  private dialogPanel!: Graphics;
  private dialogMask!: Graphics;
  private dialogContainer!: Container;
  private messagesContainer!: Container;
  private dialogMessages: { text: string; from: 'dm' | 'player' }[] = [];
  private dialogTexts: Text[] = [];
  private dialogMaxMessages = 50;
  private dialogScrollOffset = 0;
  private dialogIsAtBottom = true;
  private dialogViewportHeight = 0;
  private dialogContentWidth = 0;
  /** 对话正文相对面板左缘额外右移（像素） */
  private readonly dialogTextInset = 28;
  private pendingMessageAnimation: {
    textObj: Text;
    targetY: number;
    elapsed: number;
    duration: number;
    startY: number;
  } | null = null;

  // 输入框相关（HTML textarea，支持中文/手写输入）
  private inputBackground!: Graphics;
  private footerBar!: Graphics;
  private htmlTextarea!: HTMLTextAreaElement;
  private inputPlaceholder = '在此输入你想说的话或决策，回车发送…';
  private inputValue = '';
  private inputFocused = true;

  // 骰子区域
  private diceContainer!: Container;
  private diceHitArea!: Graphics;
  private diceSprites: Sprite[] = [];
  private diceResultText!: Text;

  /** 底栏左侧左列：状态 + 属性 */
  private footerLeftStatsText!: Text;
  /** 底栏左侧右列：装备 */
  private footerLeftEquipText!: Text;
  /** 底栏右侧：背包 + 可前往 */
  private footerExitText!: Text;

  // AI DM 系统
  private aiDirector!: AIDirector;
  private diceCheckPending = false;
  private diceLocked = true;

  // 消息队列（点击推进）
  private messageQueue: { text: string; from: 'dm' | 'player' }[] = [];
  private waitingForClick = false;
  private continueIndicator!: Text;
  private continueBlinkTimer = 0;
  private _queueFlushScheduled = false;

  // 事件监听清理
  private wheelHandler?: (e: WheelEvent) => void;

  constructor(engine: Engine, gameWidth: number = 1280, gameHeight: number = 720) {
    this.engine = engine;
    this.gameWidth = gameWidth;
    this.gameHeight = gameHeight;
    this.world = new World();

    this.backgroundContainer = new Container();
    this.container = new Container();
    this.uiContainer = new Container();

    engine.app.stage.addChild(this.backgroundContainer);
    engine.app.stage.addChild(this.container);
    engine.app.stage.addChild(this.uiContainer);
  }

  init(): void {
    this.ensureBackgroundMask();
    this.createUI();
    this.attachWheelHandler();

    // 初始化 AI DM 系统
    this.aiDirector = new AIDirector({
      onNarrate: (text, from) => this.queueOrShowMessage(text, from),
      onStateChange: () => this.refreshCharacterPanel(),
      onProcessing: (busy) => {
        if (busy) {
          this.setInputEnabled(false);
        } else if (this.messageQueue.length === 0 && !this.waitingForClick) {
          this.setInputEnabled(true);
        }
      },
      onDiceRequired: (_info: DiceCheckInfo) => {
        this.diceCheckPending = true;
        this.setDiceLocked(false);
      },
      onDiceResolved: () => {
        this.diceCheckPending = false;
        this.setDiceLocked(true);
      },
      onBlockEntered: () => this.loadSceneBackground(gameProgress.sceneVisualKey),
      onSceneVisualChange: (key) => this.loadSceneBackground(key),
    });

    // 进入第一个剧情块（会触发 onBlockEntered → 首张场景图）
    this.aiDirector.enterBlock('BLOCK_00');
  }

  /** 全屏裁切遮罩，避免立绘超出 1280×720 */
  private ensureBackgroundMask(): void {
    if (this.backgroundMaskGraphics) return;
    const mask = new Graphics();
    mask.rect(0, 0, this.gameWidth, this.gameHeight);
    mask.fill(0xffffff);
    this.backgroundMaskGraphics = mask;
    this.backgroundContainer.mask = mask;
    this.engine.app.stage.addChildAt(mask, 0);
  }

  /**
   * 按剧情块切换场景立绘；候选 URL 见 SceneBackgrounds。
   * 全部失败时用纯色兜底。
   */
  private loadSceneBackground(blockId: string): void {
    this.ensureBackgroundMask();
    this.backgroundContainer.removeChildren();

    const urls = getSceneBackgroundCandidates(blockId);
    const tryLoad = (i: number) => {
      if (i >= urls.length) {
        const fallback = new Graphics();
        fallback.rect(0, 0, this.gameWidth, this.gameHeight);
        fallback.fill(0x1a1510);
        this.backgroundContainer.addChild(fallback);
        return;
      }
      Assets.load(urls[i])
        .then((texture) => {
          const sprite = new Sprite(texture);
          const tw = texture.width;
          const th = texture.height;
          const scale = Math.max(this.gameWidth / tw, this.gameHeight / th);
          sprite.scale.set(scale);
          sprite.anchor.set(0.5);
          sprite.x = this.gameWidth / 2;
          sprite.y = this.gameHeight / 2;
          this.backgroundContainer.addChild(sprite);
        })
        .catch(() => tryLoad(i + 1));
    };
    tryLoad(0);
  }

  private createUI(): void {
    this.createLayout();
  }

  /** 监听滚轮用于对话框滚动 */
  private attachWheelHandler(): void {
    const canvas = this.engine.app.canvas as HTMLCanvasElement;
    this.wheelHandler = (e: WheelEvent) => {
      // 简单处理：滚轮只影响对话框滚动
      const delta = e.deltaY;
      if (delta === 0) return;
      const amount = delta > 0 ? 40 : -40;
      this.scrollDialog(amount);
    };
    canvas.addEventListener('wheel', this.wheelHandler);
  }

  private scrollDialog(delta: number): void {
    const contentHeight = this.getMessagesContentHeight();
    const maxOffset = Math.max(0, contentHeight - this.dialogViewportHeight);
    if (maxOffset <= 0) {
      this.dialogScrollOffset = 0;
      this.dialogIsAtBottom = true;
      this.layoutMessages();
      return;
    }
    this.dialogScrollOffset = Math.min(
      Math.max(0, this.dialogScrollOffset + delta),
      maxOffset
    );
    this.dialogIsAtBottom = this.dialogScrollOffset >= maxOffset - 1;
    this.layoutMessages();
  }

  private scrollToBottom(): void {
    const contentHeight = this.getMessagesContentHeight();
    const maxOffset = Math.max(0, contentHeight - this.dialogViewportHeight);
    this.dialogScrollOffset = maxOffset;
    this.dialogIsAtBottom = true;
    this.layoutMessages();
  }

  /** 对话区内容底部留白，与升上来的动画最终点位一致，不贴到区域最底 */
  private readonly dialogBottomPadding = 20;

  private getMessagesContentHeight(): number {
    if (this.dialogTexts.length === 0) return 0;
    const last = this.dialogTexts[this.dialogTexts.length - 1];
    return last.y + last.height + this.dialogBottomPadding;
  }

  /** 追加一条对话消息 */
  private appendDialogMessage(from: 'dm' | 'player', text: string): void {
    // 维护上限
    this.dialogMessages.push({ from, text });
    if (this.dialogMessages.length > this.dialogMaxMessages) {
      this.dialogMessages.shift();
      if (this.dialogTexts.length > 0) {
        const firstText = this.dialogTexts.shift();
        if (firstText && firstText.parent) {
          firstText.parent.removeChild(firstText);
        }
      }
      // 重新布局以回收高度
      this.layoutMessages(true);
    }

    const style = new TextStyle({
      fontFamily: 'Microsoft YaHei, sans-serif',
      fontSize: 16,
      fill: from === 'player' ? '#ff9f40' : '#ffffff',
      wordWrap: true,
      wordWrapWidth: this.dialogContentWidth || 200,
      breakWords: true, // 中文等无空格文本强制在任意字符处断行
      lineHeight: 22,
    });

    const msg = new Text({
      text,
      style,
    });
    msg.anchor.set(0, 0);

    // 计算目标 Y（添加到末尾）
    let targetY = 0;
    if (this.dialogTexts.length > 0) {
      const last = this.dialogTexts[this.dialogTexts.length - 1];
      // 两条消息之间增加更大的间距
      targetY = last.y + last.height + 14;
    }

    this.messagesContainer.addChild(msg);
    this.dialogTexts.push(msg);

    // 用最终位置算滚动，避免动画结束后跳变
    msg.x = 0;
    msg.y = targetY;
    msg.alpha = 0;
    this.dialogIsAtBottom = true;
    this.scrollToBottom();
    msg.y = targetY + 20;

    this.pendingMessageAnimation = {
      textObj: msg,
      targetY,
      elapsed: 0,
      duration: 0.25,
      startY: targetY + 20,
    };
  }

  /** 重新布局所有消息（例如删除首条后） */
  private layoutMessages(resetOffset: boolean = false): void {
    let y = 0;
    for (const t of this.dialogTexts) {
      t.y = y;
      y += t.height + 14;
    }
    if (resetOffset) {
      this.dialogScrollOffset = 0;
    }
    // 应用滚动偏移：容器内相对位移，不再叠加外部坐标
    this.messagesContainer.y = -this.dialogScrollOffset;
  }

  /** 创建 HTML textarea 覆盖在 canvas 上方，支持中文/手写输入 */
  private createHtmlTextarea(x: number, y: number, width: number, height: number): void {
    const canvas = this.engine.app.canvas as HTMLCanvasElement;
    const canvasParent = canvas.parentElement || document.body;

    const textarea = document.createElement('textarea');
    textarea.maxLength = INPUT_MAX_CHARS;
    textarea.placeholder = this.inputPlaceholder;
    textarea.style.position = 'absolute';
    textarea.style.boxSizing = 'border-box';
    textarea.style.width = `${width}px`;
    textarea.style.height = `${height}px`;
    textarea.style.fontFamily = 'Microsoft YaHei, sans-serif';
    textarea.style.fontSize = '16px';
    textarea.style.color = '#000000';
    textarea.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
    textarea.style.border = '1px solid rgba(68, 68, 68, 0.6)';
    textarea.style.borderRadius = '6px';
    textarea.style.padding = '10px 12px';
    textarea.style.resize = 'none';
    textarea.style.outline = 'none';
    textarea.style.overflow = 'auto';
    textarea.style.lineHeight = '22px';
    textarea.style.zIndex = '10';

    // 定位：相对于 canvas 的位置
    const updatePosition = () => {
      const canvasRect = canvas.getBoundingClientRect();
      const scaleX = canvasRect.width / this.gameWidth;
      const scaleY = canvasRect.height / this.gameHeight;
      textarea.style.left = `${canvasRect.left + x * scaleX}px`;
      textarea.style.top = `${canvasRect.top + y * scaleY}px`;
      textarea.style.width = `${width * scaleX}px`;
      textarea.style.height = `${height * scaleY}px`;
      textarea.style.fontSize = `${16 * Math.min(scaleX, scaleY)}px`;
    };
    updatePosition();

    // 监听窗口大小变化重新定位
    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(canvas);
    window.addEventListener('resize', updatePosition);

    const clampInput = () => {
      if (textarea.value.length > INPUT_MAX_CHARS) {
        textarea.value = textarea.value.slice(0, INPUT_MAX_CHARS);
      }
    };
    textarea.addEventListener('input', clampInput);

    // 回车发送（Shift+Enter 换行）
    textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.inputValue = textarea.value.slice(0, INPUT_MAX_CHARS);
        this.trySendInput();
        textarea.value = '';
      }
    });

    textarea.addEventListener('focus', () => {
      this.inputFocused = true;
    });
    textarea.addEventListener('blur', () => {
      this.inputFocused = false;
    });

    canvasParent.appendChild(textarea);
    this.htmlTextarea = textarea;

    // 保存清理引用
    (this as any)._textareaResizeObserver = resizeObserver;
    (this as any)._textareaResizeHandler = updatePosition;
  }

  /** 更新输入框显示文本 */
  private updateInputText(): void {
    if (this.htmlTextarea) {
      this.htmlTextarea.value = this.inputValue;
    }
  }

  /** 设置输入框启用/禁用状态 */
  private setInputEnabled(enabled: boolean): void {
    if (this.htmlTextarea) {
      this.htmlTextarea.disabled = !enabled;
      this.htmlTextarea.style.opacity = enabled ? '1' : '0.6';
      this.htmlTextarea.placeholder = enabled
        ? this.inputPlaceholder
        : 'DM 正在思考…';
    }
  }

  /* ── 消息队列系统：DM/系统文本点击推进 ── */

  /**
   * 由 AIDirector.onNarrate 回调调用。
   * - player 消息：立即显示
   * - system 消息（骰子/HP/转场等短提示）：立即显示
   * - dm 消息（叙事/念白）：加入队列，点击推进
   *
   * 使用微任务延迟首次弹出，让同步循环（如 readAloud）全部入队后再开始显示，
   * 这样多条念白会走「点击推进」，而 AI 的单条回复则自动显示不等点击。
   */
  private queueOrShowMessage(text: string, from: 'dm' | 'player' | 'system'): void {
    if (from === 'player' || from === 'system') {
      // 跳过未显示动画，避免重叠
      this.finishPendingAnimation();
      this.appendDialogMessage(from === 'player' ? 'player' : 'dm', text);
      return;
    }

    // DM 叙事消息 → 队列
    this.messageQueue.push({ text, from: 'dm' });
    // 禁用输入，直到队列清空
    this.setInputEnabled(false);

    // 用微任务批量：等当前同步调用全部入队后再弹出第一条
    if (!this.waitingForClick && !this._queueFlushScheduled) {
      this._queueFlushScheduled = true;
      Promise.resolve().then(() => {
        this._queueFlushScheduled = false;
        if (!this.waitingForClick && this.messageQueue.length > 0) {
          this.showNextQueuedMessage();
        }
      });
    }
  }

  /** 从队列取出并显示下一条消息 */
  private showNextQueuedMessage(): void {
    if (this.messageQueue.length === 0) {
      this.waitingForClick = false;
      this.continueIndicator.visible = false;
      // 队列清空后，若 AI 也不在忙，则重新启用输入
      if (!this.aiDirector.isBusy()) {
        this.setInputEnabled(true);
      }
      return;
    }
    // 立即完成上一条动画
    this.finishPendingAnimation();

    const msg = this.messageQueue.shift()!;
    this.appendDialogMessage(msg.from, msg.text);

    // 队列还有后续消息 → 需要点击推进
    if (this.messageQueue.length > 0) {
      this.waitingForClick = true;
      this.continueIndicator.visible = true;
      this.continueBlinkTimer = 0;
    } else {
      // 这是最后一条（或唯一一条），自动显示后恢复
      this.waitingForClick = false;
      this.continueIndicator.visible = false;
      if (!this.aiDirector.isBusy()) {
        this.setInputEnabled(true);
      }
    }
  }

  /** 点击对话面板 → 推进下一条 */
  private onDialogClick(): void {
    if (this.waitingForClick) {
      this.showNextQueuedMessage();
    }
  }

  /** 立即完成当前消息出现动画 */
  private finishPendingAnimation(): void {
    if (this.pendingMessageAnimation) {
      const anim = this.pendingMessageAnimation;
      anim.textObj.y = anim.targetY;
      anim.textObj.alpha = 1;
      this.pendingMessageAnimation = null;
    }
  }

  /* ── 骰子锁定 ── */

  /** 设置骰子区域锁定/解锁 */
  private setDiceLocked(locked: boolean): void {
    this.diceLocked = locked;
    if (locked) {
      this.diceHitArea.cursor = 'not-allowed';
      for (const s of this.diceSprites) {
        s.alpha = 0.3;
        s.tint = 0x666666;
      }
      this.diceResultText.text = '';
    } else {
      this.diceHitArea.cursor = 'pointer';
      for (const s of this.diceSprites) {
        s.alpha = 1.0;
        s.tint = 0xffffff;
      }
    }
  }

  /** 处理玩家按下回车发送消息 */
  private trySendInput(): void {
    const trimmed = this.inputValue.trim().slice(0, INPUT_MAX_CHARS);
    if (!trimmed) return;
    // 有待读取的队列消息或等待点击时不允许发送
    if (this.messageQueue.length > 0 || this.waitingForClick) return;
    this.inputValue = '';
    this.updateInputText();
    // 通过 AI Director 处理玩家输入
    this.aiDirector.handlePlayerInput(trimmed);
  }

  /** 加载并布局骰子图片（等比例缩放） */
  private async loadDiceSprites(areaWidth: number, areaHeight: number): Promise<void> {
    const base = getBase();
    const margin = 12;

    const textures = await Promise.all(
      DICE_IMAGE_NAMES.map((name) =>
        Assets.load(`${base}dices/${name}.png`).catch(() => null)
      )
    );

    const valid: Sprite[] = [];
    for (const tex of textures) {
      if (!tex) continue;
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      this.diceContainer.addChild(sprite);
      valid.push(sprite);
    }
    this.diceSprites = valid;

    if (valid.length === 0) return;

    // 等比例缩放并随机偏移、旋转
    const maxSize = Math.min(areaWidth, areaHeight) * 0.8;
    const centerX = areaWidth / 2;
    const centerY = areaHeight / 2;

    valid.forEach((sprite, index) => {
      const texW = sprite.texture.width;
      const texH = sprite.texture.height;
      const baseScale = Math.min(maxSize / texW, maxSize / texH);
      const scaleRandom = 0.6 + index * 0.15; // 稍微不同大小
      sprite.scale.set(baseScale * 0.6 * scaleRandom);

      // 随意摆放：围绕中心轻微散开
      const angle = (Math.PI * 2 * index) / valid.length;
      const radius = Math.min(areaWidth, areaHeight) * (0.18 + index * 0.04);
      const offsetX = Math.cos(angle) * radius;
      const offsetY = Math.sin(angle) * radius;
      sprite.x = centerX + offsetX;
      sprite.y = centerY + offsetY;

      // 随机旋转一点角度
      sprite.rotation = this.engine.randomFloat(-0.4, 0.4);
    });
  }

  /** 骰子 hover 高亮（仅在未锁定时生效） */
  private setDiceHighlight(highlight: boolean): void {
    if (this.diceLocked) return;
    const alpha = highlight ? 1.0 : 0.85;
    for (const s of this.diceSprites) {
      s.tint = 0xffffff;
      s.alpha = alpha;
    }
  }

  /** 投掷骰子 */
  private rollDice(): void {
    // 骰子被锁定时不可操作
    if (this.diceLocked) return;
    if (!this.diceCheckPending || !this.aiDirector.hasPendingDice()) return;

    const result = this.engine.randomInt(1, 21);
    this.diceResultText.text = `${result}`;

    // 有待处理的检定 → 将结果发送给 AI Director
    this.aiDirector.handleDiceRoll(result);
  }

  /**
   * 创建整体布局：
   * - 左侧：对话框（0.4W，至底栏上沿）
   * - 底部：深青灰栏；左为两列（状态+属性 | 装备），输入框略靠右，右为背包与可前往
   * - 右侧：骰子区域
   */
  private createLayout(): void {
    const w = this.gameWidth;
    const h = this.gameHeight;

    const footerHeight = Math.round(h * 0.19);
    const dialogWidth = w * 0.4;
    const dialogX = 0;
    const dialogY = 0;
    const dialogHeight = h - footerHeight;
    this.dialogViewportHeight = dialogHeight - 24; // 上下内边距后可视高度
    this.dialogContentWidth = dialogWidth - 24 - 16 - this.dialogTextInset; // 内边距 + 右移 + 滚动条留白

    // 对话背景：直角、贴左、约 80% 不透明度
    this.dialogPanel = new Graphics();
    this.dialogPanel.rect(dialogX, dialogY, dialogWidth, dialogHeight);
    this.dialogPanel.fill({ color: 0x000000, alpha: 0.8 });
    this.dialogPanel.stroke({ color: 0xffffff, width: 1, alpha: 0.3 });
    this.dialogPanel.eventMode = 'static';
    this.dialogPanel.cursor = 'pointer';
    this.dialogPanel.on('pointertap', () => this.onDialogClick());
    this.uiContainer.addChild(this.dialogPanel);

    // 对话内容容器 + mask 实现滚动
    this.dialogContainer = new Container();
    this.dialogContainer.x = dialogX + 12 + this.dialogTextInset;
    this.dialogContainer.y = dialogY + 12;

    this.messagesContainer = new Container();
    this.dialogContainer.addChild(this.messagesContainer);

    this.dialogMask = new Graphics();
    this.dialogMask.rect(this.dialogContainer.x, this.dialogContainer.y, this.dialogContentWidth, this.dialogViewportHeight);
    this.dialogMask.fill(0xffffff);
    this.messagesContainer.mask = this.dialogMask;

    this.uiContainer.addChild(this.dialogContainer);
    this.uiContainer.addChild(this.dialogMask);

    // 右侧进度条点击区域（点击回到底部）
    const progressBar = new Graphics();
    const pbWidth = 6;
    const pbHeight = this.dialogViewportHeight;
    const pbX = dialogX + dialogWidth - pbWidth - 6;
    const pbY = dialogY + 12;
    progressBar.rect(pbX, pbY, pbWidth, pbHeight);
    progressBar.fill({ color: 0xffffff, alpha: 0.1 });
    progressBar.eventMode = 'static';
    progressBar.cursor = 'pointer';
    progressBar.on('pointertap', () => {
      this.scrollToBottom();
    });
    this.uiContainer.addChild(progressBar);

    // 底部全宽深青灰内容区，顶沿金线分隔
    const footerTopY = h - footerHeight;
    const footerSeparatorH = 2;
    this.footerBar = new Graphics();
    this.footerBar.rect(0, footerTopY, w, footerHeight);
    // 深青灰底栏（与顶部分隔线区分）
    this.footerBar.fill({ color: 0x1b2a32, alpha: 1 });
    this.footerBar.rect(0, footerTopY, w, footerSeparatorH);
    this.footerBar.fill({ color: 0xc9a227, alpha: 1 });
    this.uiContainer.addChild(this.footerBar);

    const footerPad = 12;
    const footerLeftW = Math.round(w * 0.23);
    const footerRightW = Math.round(w * 0.27);
    const footerGap = 10;
    /** 输入框相对原位置再右移（像素） */
    const inputShiftRight = 18;
    const inputWidth = w - footerPad * 2 - footerLeftW - footerRightW - footerGap * 2 - inputShiftRight;
    const inputHeight = Math.min(84, footerHeight - 20);
    const inputX = footerPad + footerLeftW + footerGap + inputShiftRight;
    const inputY = footerTopY + (footerHeight - inputHeight) / 2;
    const footerRightX = w - footerPad - footerRightW;

    const leftCol1W = Math.floor(footerLeftW * 0.52);
    const leftCol2W = footerLeftW - leftCol1W - 8;
    const leftCol2X = footerPad + leftCol1W + 8;

    const footerLeftStyle = new TextStyle({
      fontFamily: 'Microsoft YaHei, sans-serif',
      fontSize: 11,
      fill: '#d4c4a0',
      align: 'left',
      wordWrap: true,
      wordWrapWidth: leftCol1W - 4,
      lineHeight: 15,
    });
    this.footerLeftStatsText = new Text({
      text: this.buildFooterLeftStatsText(),
      style: footerLeftStyle,
    });
    this.footerLeftStatsText.x = footerPad;
    this.footerLeftStatsText.y = footerTopY + 10;
    this.uiContainer.addChild(this.footerLeftStatsText);

    const footerEquipStyle = new TextStyle({
      fontFamily: 'Microsoft YaHei, sans-serif',
      fontSize: 11,
      fill: '#d4c4a0',
      align: 'left',
      wordWrap: true,
      wordWrapWidth: Math.max(80, leftCol2W - 4),
      lineHeight: 15,
    });
    this.footerLeftEquipText = new Text({
      text: this.buildFooterLeftEquipText(),
      style: footerEquipStyle,
    });
    this.footerLeftEquipText.x = leftCol2X;
    this.footerLeftEquipText.y = footerTopY + 10;
    this.uiContainer.addChild(this.footerLeftEquipText);

    const footerExitStyle = new TextStyle({
      fontFamily: 'Microsoft YaHei, sans-serif',
      fontSize: 11,
      fill: '#c8e6d0',
      align: 'left',
      wordWrap: true,
      wordWrapWidth: footerRightW - 8,
      lineHeight: 15,
    });
    this.footerExitText = new Text({
      text: this.buildFooterExitText(),
      style: footerExitStyle,
    });
    this.footerExitText.x = footerRightX;
    this.footerExitText.y = footerTopY + 10;
    this.uiContainer.addChild(this.footerExitText);

    this.inputBackground = new Graphics();
    this.inputBackground.rect(inputX, inputY, inputWidth, inputHeight);
    this.inputBackground.fill({ color: 0xffffff, alpha: 0.0 });
    this.uiContainer.addChild(this.inputBackground);

    this.createHtmlTextarea(inputX, inputY, inputWidth, inputHeight);

    // 右侧主区域（对话框以右、底栏以上）—— 仅骰子
    const rightAreaX = dialogX + dialogWidth + 12;
    const rightAreaWidth = w - rightAreaX - 10;
    const rightAreaY = 20;
    const rightAreaHeight = h - footerHeight - 40;

    this.diceContainer = new Container();
    const diceAreaWidth = rightAreaWidth * 0.58;
    const diceAreaHeight = rightAreaHeight * 0.52;
    const diceAreaX = rightAreaX + rightAreaWidth - diceAreaWidth - 8;
    const diceAreaY = rightAreaY + rightAreaHeight - diceAreaHeight - 8;

    // 判定区域 = 骰子区域内的 0.9 高 × 0.7 宽（放大以便骰子有更多显示空间）
    const innerScaleW = 0.7;
    const innerScaleH = 0.7;
    const innerWidth = diceAreaWidth * innerScaleW;
    const innerHeight = diceAreaHeight * innerScaleH;
    const innerXBase = diceAreaX + (diceAreaWidth - innerWidth) / 2;
    const innerYBase = diceAreaY + (diceAreaHeight - innerHeight) / 2;
    /** 整块骰子区相对原锚点再往右下微调 */
    const diceShiftRight = 26;
    const diceShiftDown = 22;
    const innerX = innerXBase + diceShiftRight;
    const innerY = innerYBase + diceShiftDown;

    // 骰子判定区域背景已移除（仅保留透明碰撞区）

    this.diceContainer.x = innerX;
    this.diceContainer.y = innerY;
    this.uiContainer.addChild(this.diceContainer);

    // 骰子与判定区使用内圈 0.8 尺寸
    this.loadDiceSprites(innerWidth, innerHeight);

    // 交互碰撞区：覆盖判定区域
    this.diceHitArea = new Graphics();
    this.diceHitArea.rect(innerX, innerY, innerWidth, innerHeight);
    this.diceHitArea.fill({ color: 0xffffff, alpha: 0 });
    this.diceHitArea.eventMode = 'static';
    this.diceHitArea.cursor = 'pointer';
    this.diceHitArea.on('pointerover', () => {
      this.setDiceHighlight(true);
    });
    this.diceHitArea.on('pointerout', () => {
      this.setDiceHighlight(false);
    });
    this.diceHitArea.on('pointertap', () => {
      this.rollDice();
    });
    this.uiContainer.addChild(this.diceHitArea);

    const diceTextStyle = new TextStyle({
      fontFamily: 'Courier New, monospace',
      fontSize: 28,
      fill: '#ff4040',
      stroke: { color: '#000000', width: 3 },
    });
    this.diceResultText = new Text({
      text: '',
      style: diceTextStyle,
    });
    this.diceResultText.anchor.set(0.5);
    this.diceResultText.x = innerX + innerWidth / 2;
    this.diceResultText.y = innerY + innerHeight / 2;
    this.uiContainer.addChild(this.diceResultText);

    // 初始锁定骰子（无检定时不可点击）
    this.setDiceLocked(true);

    // ▼ 点击继续 指示器（在对话框底部居中）
    const continueStyle = new TextStyle({
      fontFamily: 'Microsoft YaHei, sans-serif',
      fontSize: 14,
      fill: '#aaaaaa',
    });
    this.continueIndicator = new Text({
      text: '▼ 点击继续',
      style: continueStyle,
    });
    this.continueIndicator.anchor.set(0.5);
    this.continueIndicator.x = dialogX + dialogWidth / 2;
    this.continueIndicator.y = dialogY + dialogHeight - 14;
    this.continueIndicator.visible = false;
    this.uiContainer.addChild(this.continueIndicator);
  }

  /** 底栏左列：状态 + 属性（数值后不显示括号与调整值） */
  private buildFooterLeftStatsText(): string {
    const p = PLAYER;
    const s = playerState;
    const eq = s.equippedIds;

    const fmt = (v: number) => (v >= 0 ? `+${v}` : `${v}`);
    const hpBar = `HP ${s.hp}/${p.hpMax}${s.tempHp > 0 ? ` (+${s.tempHp})` : ''}`;
    const ac = getEffectiveAc(eq);
    const atk = getEffectiveAttackBonus(eq);

    return [
      `◈ 状态`,
      `${hpBar}  AC ${ac}`,
      `速度 ${p.speed}尺  攻击+${fmt(atk)}  ${getWeaponDamageText()}`,
      ``,
      `◈ 属性`,
      `力${p.str.value} 敏${p.dex.value} 体${p.con.value}`,
      `智${p.int.value} 感${p.wis.value} 魅${p.cha.value}`,
    ].join('\n');
  }

  /** 底栏左列右侧：装备单列 */
  private buildFooterLeftEquipText(): string {
    return [`◈ 装备`, getEquippedSummary()].join('\n');
  }

  /** 底栏右侧：背包 + 可前往 */
  private buildFooterExitText(): string {
    return [
      `◈ 背包`,
      this.buildBackpackText(),
      ``,
      `◈ 可前往`,
      getExitDestinationNames(gameProgress.currentBlockId),
    ].join('\n');
  }

  /** 构建背包文本 */
  private buildBackpackText(): string {
    if (playerState.backpack.length === 0) return '（空）';
    return playerState.backpack
      .map((item) => {
        const def = ITEMS_BY_ID[item.id];
        const name = def?.name ?? item.id;
        return item.qty > 1 ? `${name}×${item.qty}` : name;
      })
      .join('\n');
  }

  /** 刷新底栏信息（状态变化后调用） */
  private refreshCharacterPanel(): void {
    if (this.footerLeftStatsText) {
      this.footerLeftStatsText.text = this.buildFooterLeftStatsText();
    }
    if (this.footerLeftEquipText) {
      this.footerLeftEquipText.text = this.buildFooterLeftEquipText();
    }
    if (this.footerExitText) {
      this.footerExitText.text = this.buildFooterExitText();
    }
  }

  update(_deltaTime: number): void {
    this.world.setTickInfo(this.engine.tick, _deltaTime);

    // 动态刷新角色面板（playerState 可能在运行时改变）
    this.refreshCharacterPanel();

    // 对话出现动画
    if (this.pendingMessageAnimation) {
      const anim = this.pendingMessageAnimation;
      anim.elapsed += _deltaTime;
      const t = Math.min(1, anim.elapsed / anim.duration);
      const ease = t * t * (3 - 2 * t); // smoothstep
      anim.textObj.y = anim.startY + (anim.targetY - anim.startY) * ease;
      anim.textObj.alpha = ease;
      if (t >= 1) {
        this.pendingMessageAnimation = null;
        anim.textObj.y = anim.targetY;
        if (!this.dialogIsAtBottom) this.layoutMessages();
      }
    }

    // 键盘输入已由 HTML textarea 处理，无需在此逐字符监听

    // ▼ 点击继续 闪烁
    if (this.continueIndicator && this.continueIndicator.visible) {
      this.continueBlinkTimer += _deltaTime;
      this.continueIndicator.alpha = 0.4 + 0.6 * Math.abs(Math.sin(this.continueBlinkTimer * 2.5));
    }
  }

  onResize(_width: number, _height: number): void {}

  destroy(): void {
    this.backgroundContainer.removeChildren();
    this.container.removeChildren();
    this.uiContainer.removeChildren();
    this.backgroundContainer.mask = null;
    if (this.backgroundMaskGraphics?.parent) {
      this.backgroundMaskGraphics.parent.removeChild(this.backgroundMaskGraphics);
    }
    this.backgroundMaskGraphics?.destroy();
    this.backgroundMaskGraphics = null;
    this.world.clear();

    // 清理事件
    const canvas = this.engine.app.canvas as HTMLCanvasElement;
    if (this.wheelHandler) {
      canvas.removeEventListener('wheel', this.wheelHandler);
      this.wheelHandler = undefined;
    }

    // 清理 HTML textarea
    if (this.htmlTextarea && this.htmlTextarea.parentElement) {
      this.htmlTextarea.parentElement.removeChild(this.htmlTextarea);
    }
    const resizeObserver = (this as any)._textareaResizeObserver as ResizeObserver | undefined;
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    const resizeHandler = (this as any)._textareaResizeHandler as (() => void) | undefined;
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
    }
  }
}
