/**
 * World - Entity Container and Event System
 */

export interface Entity {
  id: string;
  name: string;
  x: number;
  y: number;
  [key: string]: any;
}

export type EventHandler = (data: any) => void;

export class World {
  private entities: Map<string, Entity> = new Map();
  private entitiesByTag: Map<string, Set<string>> = new Map();
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  
  private _tick: number = 0;
  private _deltaTime: number = 0;
  
  // Add entity
  addEntity(entity: Entity, tags: string[] = []): void {
    this.entities.set(entity.id, entity);
    
    for (const tag of tags) {
      if (!this.entitiesByTag.has(tag)) {
        this.entitiesByTag.set(tag, new Set());
      }
      this.entitiesByTag.get(tag)!.add(entity.id);
    }
  }
  
  // Remove entity
  removeEntity(id: string): void {
    this.entities.delete(id);
    
    for (const tagSet of this.entitiesByTag.values()) {
      tagSet.delete(id);
    }
  }
  
  // Get entity by ID
  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }
  
  // Get all entities
  getAllEntities(): Entity[] {
    return Array.from(this.entities.values());
  }
  
  // Get entities by tag
  getEntitiesByTag(tag: string): Entity[] {
    const ids = this.entitiesByTag.get(tag);
    if (!ids) return [];
    
    const result: Entity[] = [];
    for (const id of ids) {
      const entity = this.entities.get(id);
      if (entity) result.push(entity);
    }
    return result;
  }
  
  // Event system
  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }
  
  off(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    }
  }
  
  emit(event: string, data?: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }
  
  // Update tick info
  setTickInfo(tick: number, deltaTime: number): void {
    this._tick = tick;
    this._deltaTime = deltaTime;
  }
  
  get tick(): number {
    return this._tick;
  }
  
  get deltaTime(): number {
    return this._deltaTime;
  }
  
  // Clear all
  clear(): void {
    this.entities.clear();
    this.entitiesByTag.clear();
  }
  
  // Generate unique ID
  generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
