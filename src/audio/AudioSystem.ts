/**
 * Audio System - 简化版游戏音效系统
 */

// 音效配置
interface SoundConfig {
  src: string;
  volume?: number;
  throttleMs?: number;
  loop?: boolean;
}

// 音效定义
const SOUNDS: Record<string, SoundConfig> = {
  move: { src: 'move.mp3', volume: 0.3, throttleMs: 100 },
  hit_wall: { src: 'hit_wall.mp3', volume: 0.4, throttleMs: 150 },
  pickup: { src: 'pickup.mp3', volume: 0.5, throttleMs: 200 },
  click: { src: 'click.mp3', volume: 0.3, throttleMs: 50 },
};

// BGM
const BGM_FILE = 'bgm.wav';

interface LoadedSound {
  buffer: AudioBuffer;
  config: SoundConfig;
  lastPlayTime: number;
}

export class AudioSystem {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  
  private sounds: Map<string, LoadedSound> = new Map();
  private bgmBuffer: AudioBuffer | null = null;
  private currentBgmSource: AudioBufferSourceNode | null = null;
  
  private _masterVolume: number = 0.7;
  private _sfxVolume: number = 1.0;
  private _bgmVolume: number = 0.4;
  private _muted: boolean = false;
  
  private basePath: string;
  private initialized: boolean = false;
  
  constructor(basePath: string = '/assets/music/') {
    this.basePath = basePath;
  }
  
  /**
   * 初始化音频系统
   */
  async init(): Promise<boolean> {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // 创建增益节点链
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
      this.masterGain.gain.value = this._masterVolume;
      
      this.sfxGain = this.audioContext.createGain();
      this.sfxGain.connect(this.masterGain);
      this.sfxGain.gain.value = this._sfxVolume;
      
      this.bgmGain = this.audioContext.createGain();
      this.bgmGain.connect(this.masterGain);
      this.bgmGain.gain.value = this._bgmVolume;
      
      this.initialized = true;
      console.log('[AudioSystem] Initialized');
      return true;
    } catch (e) {
      console.error('[AudioSystem] Failed to initialize:', e);
      return false;
    }
  }
  
  /**
   * 确保 AudioContext 已启动（需要用户交互）
   */
  async ensureResumed(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
        console.log('[AudioSystem] AudioContext resumed');
      } catch (e) {
        console.error('[AudioSystem] Failed to resume:', e);
      }
    }
  }
  
  /**
   * 预加载所有音效
   */
  async preload(): Promise<void> {
    if (!this.audioContext) {
      await this.init();
    }
    
    // 加载音效
    for (const [key, config] of Object.entries(SOUNDS)) {
      try {
        const buffer = await this.loadAudioFile(config.src);
        this.sounds.set(key, {
          buffer,
          config,
          lastPlayTime: 0,
        });
      } catch (e) {
        console.warn(`[AudioSystem] Failed to load ${key}:`, e);
      }
    }
    
    // 加载 BGM
    try {
      this.bgmBuffer = await this.loadAudioFile(BGM_FILE);
    } catch (e) {
      console.warn('[AudioSystem] Failed to load BGM:', e);
    }
    
    console.log(`[AudioSystem] Loaded ${this.sounds.size} sounds`);
  }
  
  /**
   * 加载单个音频文件
   */
  private async loadAudioFile(filename: string): Promise<AudioBuffer> {
    if (!this.audioContext) throw new Error('AudioContext not initialized');
    
    const response = await fetch(this.basePath + filename);
    const arrayBuffer = await response.arrayBuffer();
    return await this.audioContext.decodeAudioData(arrayBuffer);
  }
  
  /**
   * 播放音效
   */
  play(soundId: string, options?: { volume?: number }): void {
    if (!this.initialized || this._muted || !this.audioContext || !this.sfxGain) return;
    
    const sound = this.sounds.get(soundId);
    if (!sound) return;
    
    const now = performance.now();
    
    // 节流
    if (sound.config.throttleMs && now - sound.lastPlayTime < sound.config.throttleMs) return;
    
    try {
      const source = this.audioContext.createBufferSource();
      source.buffer = sound.buffer;
      
      const gainNode = this.audioContext.createGain();
      const volume = (options?.volume ?? 1) * (sound.config.volume ?? 1);
      gainNode.gain.value = volume;
      
      source.connect(gainNode);
      gainNode.connect(this.sfxGain);
      source.start(0);
      
      sound.lastPlayTime = now;
    } catch (e) {
      console.error(`[AudioSystem] Failed to play ${soundId}:`, e);
    }
  }
  
  /**
   * 播放 BGM
   */
  playBGM(): void {
    if (!this.initialized || !this.audioContext || !this.bgmGain || !this.bgmBuffer) return;
    
    this.stopBGM();
    
    try {
      this.currentBgmSource = this.audioContext.createBufferSource();
      this.currentBgmSource.buffer = this.bgmBuffer;
      this.currentBgmSource.loop = true;
      this.currentBgmSource.connect(this.bgmGain);
      this.currentBgmSource.start(0);
      
      console.log('[AudioSystem] Playing BGM');
    } catch (e) {
      console.error('[AudioSystem] Failed to play BGM:', e);
    }
  }
  
  /**
   * 停止 BGM
   */
  stopBGM(): void {
    if (this.currentBgmSource) {
      try {
        this.currentBgmSource.stop();
      } catch (e) {
        // Ignore
      }
      this.currentBgmSource = null;
    }
  }
  
  // Volume controls
  get masterVolume(): number { return this._masterVolume; }
  set masterVolume(value: number) {
    this._masterVolume = Math.max(0, Math.min(1, value));
    if (this.masterGain) {
      this.masterGain.gain.value = this._masterVolume;
    }
  }
  
  get muted(): boolean { return this._muted; }
  set muted(value: boolean) {
    this._muted = value;
    if (this.masterGain) {
      this.masterGain.gain.value = value ? 0 : this._masterVolume;
    }
  }
  
  toggleMute(): void {
    this.muted = !this.muted;
  }
  
  destroy(): void {
    this.stopBGM();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.sounds.clear();
    this.bgmBuffer = null;
    this.initialized = false;
  }
}

// 全局单例
let audioSystem: AudioSystem | null = null;

export function getAudioSystem(): AudioSystem {
  if (!audioSystem) {
    audioSystem = new AudioSystem();
  }
  return audioSystem;
}
