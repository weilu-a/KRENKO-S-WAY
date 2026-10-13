/**
 * Platform Bridge - Communication with parent platform
 */

export interface PlatformCommand {
  type: string;
  [key: string]: any;
}

export type CommandHandler = (cmd: PlatformCommand) => void;

export class PlatformBridge {
  private commandHandlers: CommandHandler[] = [];
  
  constructor() {
    // Listen for messages from parent
    window.addEventListener('message', this.handleMessage.bind(this));
  }
  
  private handleMessage(event: MessageEvent): void {
    const data = event.data;
    if (!data || typeof data.type !== 'string') return;
    
    for (const handler of this.commandHandlers) {
      handler(data);
    }
  }
  
  onCommand(handler: CommandHandler): void {
    this.commandHandlers.push(handler);
  }
  
  sendReady(): void {
    this.sendMessage({ type: 'ready' });
  }
  
  sendStateChange(state: any): void {
    this.sendMessage({ type: 'stateChange', state });
  }
  
  private sendMessage(data: any): void {
    if (window.parent !== window) {
      window.parent.postMessage(data, '*');
    }
  }
}
