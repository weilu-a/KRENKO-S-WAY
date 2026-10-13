# VAG Playground - PixiJS 2D

这是一个基于 PixiJS 的 2D 游戏项目。

## 重要：技术栈限制

**禁止使用 Python 或任何后端语言。** 本项目是纯前端游戏项目，只能使用以下技术栈：

- **TypeScript** - 主要开发语言
- **JavaScript** - 可选
- **Vite** - 构建工具
- **PixiJS** - 渲染引擎
- **HTML/CSS** - 页面结构和样式

所有游戏逻辑必须在浏览器端运行，通过 Vite 开发服务器提供 HMR 支持。

## 项目结构（统一规范）

```
├── index.html           # 入口 HTML
├── package.json         # 依赖配置
├── vite.config.ts       # Vite 配置
├── tsconfig.json        # TypeScript 配置
├── assets/              # 资源目录
│   ├── background.png   # 游戏背景图（1280×720 裁切显示，可将 image.png 放于此）
│   └── music/           # 音频资源
└── src/
    ├── main.ts          # 游戏入口
    ├── ai/              # AI 接口（火山方舟 / Ollama 跑团 DM）
    │   ├── LLMClient.ts # 统一入口
    │   ├── ArkClient.ts # 方舟 OpenAI 兼容 chat/completions
    │   └── OllamaClient.ts
    ├── engine/          # 引擎核心（通用功能）
    │   ├── Engine.ts    # 引擎主类
    │   ├── Input.ts     # 输入处理
    │   └── World.ts     # 世界管理
    ├── audio/           # 音频系统
    │   └── AudioSystem.ts
    ├── game/            # 游戏逻辑（主要开发区）
    │   ├── MainScene.ts # 主场景
    │   └── systems/     # 游戏系统（含 AI DM）
    │       ├── AIDirector.ts   # DM 导演：提示词 + 落地副作用
    │       └── react/          # ReAct 循环（思考 / 行为 / 反思）
    │           ├── ReActLoop.ts      # 循环本体：重试、回灌、降级、反思
    │           ├── ActionRegistry.ts # 动作目录 + 白名单校验 + 归并
    │           ├── Prompts.ts        # 三阶段任务提示词
    │           └── ReActTypes.ts     # 类型契约
    ├── entities/        # 实体/角色/游戏对象
    ├── systems/         # 游戏系统（碰撞、AI、物理等）
    ├── ui/              # UI 组件（菜单、HUD、对话框）
    ├── utils/           # 工具函数
    └── platform/        # 平台通信（不要修改）
        └── Bridge.ts
```

## 目录职责

| 目录 | 职责 | 示例 |
|------|------|------|
| `engine/` | 引擎核心功能 | 游戏循环、输入、世界管理 |
| `audio/` | 音频系统 | 音效播放、BGM 管理 |
| `game/` | 游戏主逻辑 | 场景、关卡、游戏流程 |
| `entities/` | 游戏实体 | Player.ts, Enemy.ts, Item.ts |
| `systems/` | 游戏系统 | CollisionSystem.ts, AISystem.ts |
| `ui/` | UI 组件 | Menu.ts, HUD.ts, Dialog.ts |
| `utils/` | 工具函数 | math.ts, helpers.ts |
| `platform/` | 平台通信 | **不要修改** |

## 开发指南

1. 主要在 `src/game/MainScene.ts` 中编写游戏逻辑
2. 游戏实体放在 `src/entities/` 目录
3. 复杂系统放在 `src/systems/` 目录
4. UI 组件放在 `src/ui/` 目录
5. 使用 PixiJS 的 API 创建精灵、容器、处理渲染
6. 使用 `src/engine/` 中的工具类来管理游戏循环和输入
7. 音频资源放在 `assets/music/` 目录下
8. 游戏区域固定 1280×720，背景图放在 `assets/background.png`（会按比例裁切、不拉伸）
9. AI 对话使用 `src/ai/LLMClient.ts`：`initLLM()` 在 main 中已初始化；默认火山方舟（豆包等，见 `.env.example` 中 `VITE_ARK_*`），可选 `VITE_LLM_PROVIDER=ollama` 走本地；游戏内可调用 `chat` / `generateContent` / `chatMessages`（无状态多消息，ReAct 用）

## AI DM：ReAct 循环

DM 的每次回应都是 ReAct（Reasoning + Acting）三步，实现在 `src/game/systems/react/`，由 `AIDirector.runRound()` 驱动：

1. **思考轮**（`runReasonPhase`）：产出 `{"thought","reply"}`。`thought` 是指导行为的内部思考（只进 console，玩家看不到）；`reply` 是**直接给玩家的回复**。
2. **行为轮**（`runActPhase`）：把 `thought` 与 `reply` **原文一起注入**，只产出机器动作 `{"actions":[...]}`（`dice`/`battle`/`hp`/`item`/`flag`/`scene_visual`/`transition`/`npc_effect`）。本阶段不再写叙事，必须与 reply 一致。
3. **静默反思**（`startReflection`）：落地后 fire-and-forget 生成反思，注入**下一轮**思考轮（下一轮开始前会 `await` 未决的反思）。转场回合不生成反思。

失败处理（`ReActLoop`）：

- 每个阶段最多 **3 次尝试**，失败时把「上一轮非法原文 + 具体错误」回灌重试。
- 行为轮失败只重跑行为轮，沿用同一份 reply —— 玩家看到的回复不会被推翻。
- 校验分两类：**硬错误**（白名单外的 transition/battle/item/npc、dice 与 battle 冲突等）触发回灌重试；**软修正**（DC 与 hp 越界钳制、战斗链进行中的 dice/battle 丢弃等）由引擎直接改，只记日志。
- 鉴权/参数类错误立即失败，不做回灌；网络抖动最多额外重试 1 次。
- 三次用尽 → 降级为「只呈现叙事、不产生动作」，绝不锁死状态机。

各阶段的提示词在 `Prompts.ts`；动作目录、白名单校验与 `AIResponse` 归并在 `ActionRegistry.ts`；世界观与规则在 `AIDirector.buildSystemPrompt()`（**不再规定输出格式**）。
