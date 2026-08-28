declare module 'cc' {
  type Constructor<T> = new (...args: never[]) => T;

  export class Color {
    constructor(r?: number, g?: number, b?: number, a?: number);
  }

  export class Vec2 {
    constructor(x?: number, y?: number);
    x: number;
    y: number;
    set(x: number, y: number): void;
  }

  export class Rect {
    constructor(x?: number, y?: number, width?: number, height?: number);
  }

  export class Component {
    node: Node;
    readonly isValid: boolean;
  }

  export class EventTouch {
    getID(): number;
    getUILocation(): Vec2;
  }

  export class Node {
    static readonly EventType: {
      readonly TOUCH_START: string;
      readonly TOUCH_MOVE: string;
      readonly TOUCH_END: string;
      readonly TOUCH_CANCEL: string;
    };
    constructor(name?: string);
    active: boolean;
    addChild(node: Node): void;
    addComponent<T>(type: Constructor<T>): T;
    getComponent<T>(type: Constructor<T>): T | null;
    destroy(): boolean;
    on(type: string, callback: (...args: never[]) => void, target?: unknown): void;
    off(type: string, callback: (...args: never[]) => void, target?: unknown): void;
    setPosition(x: number, y: number, z?: number): void;
    setScale(x: number, y: number, z?: number): void;
    setSiblingIndex(index: number): void;
  }

  export class UITransform extends Component {
    setContentSize(width: number, height: number): void;
    setAnchorPoint(x: number, y: number): void;
  }

  export class Graphics extends Component {
    fillColor: Color;
    strokeColor: Color;
    lineWidth: number;
    clear(): void;
    rect(x: number, y: number, width: number, height: number): void;
    circle(x: number, y: number, radius: number): void;
    fill(): void;
    stroke(): void;
  }

  export class Label extends Component {
    string: string;
    fontSize: number;
    lineHeight: number;
    color: Color;
  }

  export class Texture2D {
    addRef(): this;
    decRef(): this;
  }

  export class SpriteFrame {
    texture: Texture2D;
    rect: Rect;
    destroy(): boolean;
  }

  export class Sprite extends Component {
    spriteFrame: SpriteFrame | null;
    sizeMode: Sprite.SizeMode;
  }

  export namespace Sprite {
    enum SizeMode {
      CUSTOM = 0,
    }
  }

  export const ResolutionPolicy: {
    readonly SHOW_ALL: number;
  };

  export class Game {
    static readonly EVENT_HIDE: string;
    static readonly EVENT_SHOW: string;
  }

  export const game: {
    on(type: string, callback: (...args: never[]) => void, target?: unknown): void;
    off(type: string, callback: (...args: never[]) => void, target?: unknown): void;
  };

  export const resources: {
    load<T>(
      path: string,
      type: Constructor<T>,
      callback: (error: Error | null, asset: T) => void,
    ): void;
  };

  export const view: {
    setDesignResolutionSize(width: number, height: number, policy: number): void;
  };

  export const _decorator: {
    ccclass(name: string): ClassDecorator;
  };
}
