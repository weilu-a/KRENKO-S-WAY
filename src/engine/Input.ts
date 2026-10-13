/**
 * Input System
 */

export class Input {
  private keys: Map<string, boolean> = new Map();
  private keysJustPressed: Map<string, boolean> = new Map();
  private keysJustReleased: Map<string, boolean> = new Map();
  
  private mousePosition: { x: number; y: number } = { x: 0, y: 0 };
  private mouseButtons: Map<number, boolean> = new Map();
  private mouseButtonsJustPressed: Map<number, boolean> = new Map();
  
  constructor(canvas: HTMLCanvasElement) {
    // Keyboard events
    window.addEventListener('keydown', this.onKeyDown.bind(this));
    window.addEventListener('keyup', this.onKeyUp.bind(this));
    
    // Mouse events
    canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
    canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
    
    // Prevent context menu
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  
  private onKeyDown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    if (!this.keys.get(key)) {
      this.keysJustPressed.set(key, true);
    }
    this.keys.set(key, true);
  }
  
  private onKeyUp(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    this.keys.set(key, false);
    this.keysJustReleased.set(key, true);
  }
  
  private onMouseMove(e: MouseEvent): void {
    this.mousePosition.x = e.clientX;
    this.mousePosition.y = e.clientY;
  }
  
  private onMouseDown(e: MouseEvent): void {
    if (!this.mouseButtons.get(e.button)) {
      this.mouseButtonsJustPressed.set(e.button, true);
    }
    this.mouseButtons.set(e.button, true);
  }
  
  private onMouseUp(e: MouseEvent): void {
    this.mouseButtons.set(e.button, false);
  }
  
  update(): void {
    // Clear just pressed/released states
    this.keysJustPressed.clear();
    this.keysJustReleased.clear();
    this.mouseButtonsJustPressed.clear();
  }
  
  // Keyboard
  isKeyDown(key: string): boolean {
    return this.keys.get(key.toLowerCase()) || false;
  }
  
  isKeyJustPressed(key: string): boolean {
    return this.keysJustPressed.get(key.toLowerCase()) || false;
  }
  
  isKeyJustReleased(key: string): boolean {
    return this.keysJustReleased.get(key.toLowerCase()) || false;
  }
  
  // Directional input
  getHorizontal(): number {
    let h = 0;
    if (this.isKeyDown('a') || this.isKeyDown('arrowleft')) h -= 1;
    if (this.isKeyDown('d') || this.isKeyDown('arrowright')) h += 1;
    return h;
  }
  
  getVertical(): number {
    let v = 0;
    if (this.isKeyDown('w') || this.isKeyDown('arrowup')) v -= 1;
    if (this.isKeyDown('s') || this.isKeyDown('arrowdown')) v += 1;
    return v;
  }
  
  // Mouse
  getMousePosition(): { x: number; y: number } {
    return { ...this.mousePosition };
  }
  
  isMouseButtonDown(button: number = 0): boolean {
    return this.mouseButtons.get(button) || false;
  }
  
  isMouseButtonJustPressed(button: number = 0): boolean {
    return this.mouseButtonsJustPressed.get(button) || false;
  }
}
