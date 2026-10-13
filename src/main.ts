/**
 * PixiJS 2D Game - Main Entry
 * 游戏区域固定 1280×720，其余为黑色不交互
 */

import { Application } from 'pixi.js';
import { Engine } from './engine/Engine';
import { MainScene } from './game/MainScene';
import { PlatformBridge } from './platform/Bridge';
import { initLLM } from './ai/LLMClient';

/** 固定游戏区域尺寸 */
const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;

async function main() {
  // 初始化 LLM：默认火山方舟，或本地 Ollama（见 .env 中 VITE_LLM_PROVIDER）
  initLLM();

  // Remove loading indicator
  const loading = document.querySelector('.loading');
  if (loading) loading.remove();

  // Create PixiJS Application - 固定 1280×720，不随窗口拉伸
  const app = new Application();
  await app.init({
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: 0x000000,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: false,
  });

  // 画布放入容器：容器黑色、居中，仅 1280×720 可交互
  const container = document.getElementById('game-container');
  if (container) {
    container.appendChild(app.canvas);
  }

  // Initialize platform bridge
  const bridge = new PlatformBridge();

  // Create engine
  const engine = new Engine(app);

  // Create main scene（传入固定尺寸）
  const scene = new MainScene(engine, GAME_WIDTH, GAME_HEIGHT);
  engine.setScene(scene);

  // 窗口缩放时保持游戏区 1280×720，不改变画布尺寸
  window.addEventListener('resize', () => {
    scene.onResize(window.innerWidth, window.innerHeight);
  });

  // Notify platform that game is ready
  bridge.sendReady();

  // Listen for platform commands
  bridge.onCommand((cmd) => {
    switch (cmd.type) {
      case 'play':
        engine.play();
        break;
      case 'pause':
        engine.pause();
        break;
      case 'reset':
        engine.reset();
        break;
    }
  });

  // Start the game
  engine.start();

  // Focus canvas for keyboard input
  app.canvas.focus();
  app.canvas.tabIndex = 0;
}

main().catch(console.error);
