# 场景立绘（背景图）

切换剧情块（`BLOCK_00` … `BLOCK_10`）时，游戏会按顺序尝试加载本目录下的图片；若都不存在，则回退到项目根下的 `assets/background.png`。

**文生图提示词（莫比斯风、无主体人物、与模组地点对应）：** 见同目录 **[SCENE_PROMPTS.md](./SCENE_PROMPTS.md)**。

## 放在哪里

- **目录**：`assets/backgrounds/`（本目录）
- Vite 的 `publicDir` 为 `assets`，因此浏览器访问路径为：`<BASE_URL>backgrounds/<文件名>`

## 如何命名

文件名必须与**剧情块 ID**一致，扩展名任选一种（按下面顺序尝试）：

| 优先顺序 | 示例 |
|----------|------|
| 1 | `BLOCK_00.png` |
| 2 | `BLOCK_00.jpg` |
| 3 | `BLOCK_00.jpeg` |
| 4 | `BLOCK_00.webp` |

即：**`<剧情块ID>.<扩展名>`**（与 `StoryBlocks` / `sceneVisualKey` 一致）。

**代码中的加载逻辑（已包含全部 `BLOCK_00`…`BLOCK_10`）：** 进入剧情块时 `gameProgress.sceneVisualKey` 默认等于该块 ID（无子场景的块即加载 `backgrounds/BLOCK_XX.*`）。实现见 [`MainScene.ts`](../../src/game/MainScene.ts) 中 `loadSceneBackground`，以及 [`SceneBackgrounds.ts`](../../src/game/data/SceneBackgrounds.ts) 中 `getSceneBackgroundCandidates`。

| 文件名 | 剧情块 / 说明 |
|--------|----------------|
| `BLOCK_00` | 开始冒险 |
| `BLOCK_01` | 纳休斯·文简报 |
| `BLOCK_02` | 会见联络人 |
| `BLOCK_03` | 蒐集谣言 |
| `BLOCK_04` | 广场西下水道 |
| `BLOCK_05` | 锡街集场（默认） |
| `BLOCK_05_tavern` | 锡街·磨石酒馆（子场景，仅 BLOCK_05 内） |
| `BLOCK_05_falish_workshop` | 锡街·法莉什工坊（子场景，仅 BLOCK_05 内） |
| `BLOCK_06` | 锻炉街 |
| `BLOCK_07` | 克仑可藏身处 |
| `BLOCK_08` | 直面克仑可 |
| `BLOCK_09` | 移交 |
| `BLOCK_10` | 结局 |

完整 ID 列表与锡街子场景键：`src/game/data/SceneBackgrounds.ts` 中的 `STORY_BLOCK_IDS`、`SCENE_VISUAL_KEYS_BY_BLOCK`。

## 规格建议

- **比例**：横版，建议 **16:9**；游戏窗口固定 **1280×720**，立绘会**等比放大并裁切**（cover），不拉伸变形。
- **分辨率**：≥ **1280×720**（更高亦可，由引擎缩放）。
- **格式**：优先 **PNG**（带透明通道时需注意：背景层通常不需要透明）。

## 未放置某块图片时

该块会先尝试 `BLOCK_XX.png` 等失败，再使用全局 `assets/background.png`，再失败则使用内置占位纯色底。
