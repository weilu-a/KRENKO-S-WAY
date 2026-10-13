/**
 * PixiJS 2D Game Engine
 */

import { Application, Ticker } from 'pixi.js';
import { Input } from './Input';
import { World } from './World';

export interface GameScene {
  world: World;
  init(): void;
  update(deltaTime: number): void;
  onResize(width: number, height: number): void;
  destroy(): void;
}

export class Engine {
  public app: Application;
  public input: Input;
  public world: World;
  
  private scene: GameScene | null = null;
  private _running: boolean = false;
  private _paused: boolean = false;
  private _tick: number = 0;
  private _elapsedTime: number = 0;
  
  constructor(app: Application) {
    this.app = app;
    this.input = new Input(app.canvas as HTMLCanvasElement);
    this.world = new World();
  }
  
  setScene(scene: GameScene): void {
    if (this.scene) {
      this.scene.destroy();
    }
    this.scene = scene;
    this.world = scene.world;
    scene.init();
  }
  
  start(): void {
    this._running = true;
    this._paused = false;
    
    this.app.ticker.add(this.gameLoop, this);
  }
  
  stop(): void {
    this._running = false;
    this.app.ticker.remove(this.gameLoop, this);
  }
  
  play(): void {
    this._paused = false;
  }
  
  pause(): void {
    this._paused = true;
  }
  
  reset(): void {
    this._tick = 0;
    this._elapsedTime = 0;
    if (this.scene) {
      this.scene.destroy();
      this.scene.init();
    }
  }
  
  private gameLoop = (ticker: Ticker): void => {
    if (!this._running || this._paused) return;
    
    const deltaTime = ticker.deltaMS / 1000; // Convert to seconds
    this._elapsedTime += deltaTime;
    this._tick++;
    
    // Update scene (before input.update() so isKeyJustPressed works)
    if (this.scene) {
      this.scene.update(deltaTime);
    }
    
    // Clear input state after scene has processed it
    this.input.update();
  };
  
  get tick(): number {
    return this._tick;
  }
  
  get elapsedTime(): number {
    return this._elapsedTime;
  }
  
  get isRunning(): boolean {
    return this._running && !this._paused;
  }
  
  // Utility functions
  random(): number {
    return Math.random();
  }
  
  randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min)) + min;
  }
  
  randomFloat(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }
}
