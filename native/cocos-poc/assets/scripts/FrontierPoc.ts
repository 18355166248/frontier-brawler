import {
  Color,
  Component,
  EventTouch,
  Game,
  Graphics,
  Label,
  Node,
  Rect,
  ResolutionPolicy,
  Sprite,
  SpriteFrame,
  Texture2D,
  UITransform,
  Vec2,
  _decorator,
  game,
  resources,
  view,
} from 'cc';
import {
  EMPTY_INPUT,
  FixedStepClock,
  Run,
  STAGES,
  TICK_RATE,
  createProfile,
  resolveAction,
} from './FrontierCoreAdapter';

const { ccclass } = _decorator;
const DESIGN_WIDTH = 540;
const DESIGN_HEIGHT = 960;
const CONTROL_HEIGHT = 250;
const CELL_SIZE = 96;
const SPRITE_BASELINE = 90;
const HERO_ROWS = ['idle', 'move', 'slash', 'slash2', 'dash', 'hit'] as const;
const GRUNT_ROWS = ['idle', 'move', 'slash', 'hit'] as const;
const BACKGROUND_COLOR = new Color(9, 13, 16, 255);
const ARENA_COLOR = new Color(20, 27, 31, 255);
const PLAYER_COLOR = new Color(72, 205, 175, 255);
const ENEMY_COLOR = new Color(224, 83, 74, 255);
const CONTROL_BORDER_COLOR = new Color(120, 136, 143, 200);
const HUD_TRACK_COLOR = new Color(35, 45, 50, 235);
const HP_COLOR = new Color(221, 77, 68, 255);
const ENERGY_COLOR = new Color(63, 180, 217, 255);
const UI_TEXT_COLOR = new Color(231, 238, 239, 255);

type ActionKey = 'attack' | 'dash' | 'skill' | 'execute' | 'jump';

// 共享逻辑通过本地 npm 包进入 Creator，避免维护一份会逐渐分叉的 core 副本。

/**
 * 第一阶段只验证三件事：现有 core 能被 Creator 加载、原生 update(dt) 仍按
 * 固定 60Hz 推进、竖屏触控不会遮住战场。正式精灵与完整 HUD 在这三项通过后接入。
 */
@ccclass('FrontierPoc')
export class FrontierPoc extends Component {
  private readonly clock = new FixedStepClock({ tickRate: TICK_RATE });
  private readonly run = new Run(STAGES[0], createProfile());
  private input = { ...EMPTY_INPUT };
  private graphics: Graphics | null = null;
  private statusLabel: Label | null = null;
  private hintLabel: Label | null = null;
  private joystickTouchId: number | null = null;
  private joystickOrigin = new Vec2();
  private readonly actionTouches = new Map<number, ActionKey>();
  private readonly spriteFrames = new Map<string, SpriteFrame[]>();
  private readonly textures = new Map<string, Texture2D>();
  private readonly spriteNodes = new Map<number, Node>();
  private readonly warnedActions = new Set<string>();
  private artReady = false;
  private paused = false;
  private disposed = false;

  onLoad(): void {
    view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, ResolutionPolicy.SHOW_ALL);
    this.run.setProfession('heavy');
    // 起始房是无敌人的出发点；POC 直接进入 v1，确保验证到实体更新与敌人 AI。
    this.run.enterRoom('v1', null);
    this.graphics = this.getOrCreateGraphics();
    this.createHud();
    void this.loadActionSheets();
    this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
    this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    game.on(Game.EVENT_HIDE, this.onGameHide, this);
    game.on(Game.EVENT_SHOW, this.onGameShow, this);
  }

  onDestroy(): void {
    // 原生场景切换时必须解除监听；否则重新进入场景会让一次触摸被消费多次。
    this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
    this.node.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
    this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    game.off(Game.EVENT_HIDE, this.onGameHide, this);
    game.off(Game.EVENT_SHOW, this.onGameShow, this);
    this.disposed = true;
    for (const node of this.spriteNodes.values()) node.destroy();
    this.spriteNodes.clear();
    for (const frames of this.spriteFrames.values()) {
      for (const frame of frames) frame.destroy();
    }
    this.spriteFrames.clear();
    for (const texture of this.textures.values()) texture.decRef();
    this.textures.clear();
  }

  update(deltaTime: number): void {
    // attackHeld 是跨帧电平；只有 attack 等动作触发字段是单次按下沿。
    this.input.attackHeld = [...this.actionTouches.values()].includes('attack');
    this.clock.consume(deltaTime * 1000, this.paused, () => {
      this.run.step(this.input);
      // 动作键是按下沿；每个渲染帧最多只允许逻辑层消费一次。
      this.input.attack = false;
      this.input.dash = false;
      this.input.skill = false;
      this.input.execute = false;
      this.input.jump = false;
    });
    this.drawDebugWorld();
    this.updateHud();
    this.syncEntitySprites();
  }

  private getOrCreateGraphics(): Graphics {
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    transform.setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    return this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
  }

  private onTouchStart(event: EventTouch): void {
    const point = event.getUILocation();
    if (point.y > CONTROL_HEIGHT) return;
    if (point.x < DESIGN_WIDTH * 0.48 && this.joystickTouchId === null) {
      this.joystickTouchId = event.getID();
      this.joystickOrigin.set(point.x, point.y);
      return;
    }
    this.pressAction(event.getID(), point.x, point.y);
  }

  private onTouchMove(event: EventTouch): void {
    if (event.getID() !== this.joystickTouchId) return;
    const point = event.getUILocation();
    const dx = point.x - this.joystickOrigin.x;
    const dy = point.y - this.joystickOrigin.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const scale = Math.min(1, length / 72);
    this.input.moveX = (dx / length) * scale;
    this.input.moveY = (dy / length) * scale;
  }

  private onTouchEnd(event: EventTouch): void {
    const touchId = event.getID();
    if (touchId === this.joystickTouchId) {
      this.joystickTouchId = null;
      this.input.moveX = 0;
      this.input.moveY = 0;
    }
    this.actionTouches.delete(touchId);
    this.input.attackHeld = [...this.actionTouches.values()].includes('attack');
  }

  private pressAction(touchId: number, x: number, y: number): void {
    const column = Math.max(0, Math.min(2, Math.floor((x - DESIGN_WIDTH * 0.48) / 94)));
    const upper = y > CONTROL_HEIGHT / 2;
    let action: ActionKey;
    if (upper && column === 0) action = 'jump';
    else if (upper && column === 1) action = 'skill';
    else if (upper) action = 'execute';
    else if (column === 0) action = 'dash';
    else action = 'attack';
    this.actionTouches.set(touchId, action);
    this.input[action] = true;
    this.input.attackHeld = [...this.actionTouches.values()].includes('attack');
  }

  private drawDebugWorld(): void {
    const graphics = this.graphics;
    if (!graphics) return;
    graphics.clear();
    graphics.fillColor = BACKGROUND_COLOR;
    graphics.rect(-DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, DESIGN_WIDTH, DESIGN_HEIGHT);
    graphics.fill();
    graphics.fillColor = ARENA_COLOR;
    graphics.rect(-DESIGN_WIDTH / 2 + 16, -DESIGN_HEIGHT / 2 + CONTROL_HEIGHT, DESIGN_WIDTH - 32, DESIGN_HEIGHT - CONTROL_HEIGHT - 16);
    graphics.fill();

    if (!this.artReady) {
      for (const entity of this.run.world.entities) {
        if (entity.dead) continue;
        const { x, y } = this.worldToScreen(entity.pos.x, entity.pos.y);
        graphics.fillColor = entity.team === 'player'
          ? PLAYER_COLOR
          : ENEMY_COLOR;
        graphics.circle(x, y, entity.team === 'player' ? 18 : 14);
        graphics.fill();
      }
    }

    graphics.strokeColor = CONTROL_BORDER_COLOR;
    graphics.lineWidth = 2;
    graphics.rect(-DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, DESIGN_WIDTH, CONTROL_HEIGHT);
    graphics.stroke();

    // 控件轮廓与真实触摸热区使用同一组常量，避免“看得到却按不到”。
    graphics.circle(-140, -355, 72);
    graphics.stroke();
    graphics.circle(-140 + this.input.moveX * 38, -355 + this.input.moveY * 38, 30);
    graphics.stroke();
    for (const x of [36, 130, 224]) {
      graphics.circle(x, -292, 38);
      graphics.stroke();
    }
    graphics.circle(36, -417, 38);
    graphics.stroke();
    graphics.rect(83, -455, 181, 76);
    graphics.stroke();

    const player = this.run.world.entities.find((entity) => entity.team === 'player');
    if (player) {
      this.drawBar(graphics, -250, 426, 300, 18, player.hp / player.maxHp, HP_COLOR);
      this.drawBar(graphics, -250, 400, 220, 12, player.energy / player.maxEnergy, ENERGY_COLOR);
    }
  }

  private drawBar(
    graphics: Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    ratio: number,
    color: Color,
  ): void {
    graphics.fillColor = HUD_TRACK_COLOR;
    graphics.rect(x, y, width, height);
    graphics.fill();
    graphics.fillColor = color;
    graphics.rect(x, y, width * Math.max(0, Math.min(1, ratio)), height);
    graphics.fill();
  }

  private createHud(): void {
    this.statusLabel = this.createLabel('status', -250, 452, 20);
    this.hintLabel = this.createLabel('hint', 70, 425, 18);
    this.createLabel('jump', 18, -300, 18).string = '跃';
    this.createLabel('skill', 112, -300, 18).string = '技';
    this.createLabel('execute', 206, -300, 18).string = '决';
    this.createLabel('dash', 18, -425, 18).string = '闪';
    this.createLabel('attack', 145, -425, 20).string = '攻击';
  }

  private createLabel(name: string, x: number, y: number, fontSize: number): Label {
    const node = new Node(name);
    const transform = node.addComponent(UITransform);
    transform.setContentSize(name === 'status' ? 330 : 100, 32);
    transform.setAnchorPoint(0, 0.5);
    const label = node.addComponent(Label);
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 4;
    label.color = UI_TEXT_COLOR;
    node.setPosition(x, y, 0);
    this.node.addChild(node);
    return label;
  }

  private updateHud(): void {
    const player = this.run.world.entities.find((entity) => entity.team === 'player');
    const enemies = this.run.world.entities.filter(
      (entity) => entity.team === 'enemy' && !entity.dead,
    ).length;
    if (this.statusLabel && player) {
      this.statusLabel.string = `生命 ${Math.ceil(player.hp)}/${Math.ceil(player.maxHp)}  ·  能量 ${Math.floor(player.energy)}`;
    }
    if (this.hintLabel) {
      const phaseText = this.run.phase === 'cleared' ? '向右进入下一房' : `${enemies} 名敌人`;
      this.hintLabel.string = `${this.run.room.id}  ${phaseText}`;
    }
  }

  private async loadActionSheets(): Promise<void> {
    try {
      const [hero, grunt] = await Promise.all([
        this.loadTexture('generated-art/hero-v2/texture'),
        this.loadTexture('generated-art/enemy-grunt-v2/texture'),
      ]);
      if (this.disposed || !this.isValid) return;
      hero.addRef();
      grunt.addRef();
      this.textures.set('hero', hero);
      this.textures.set('grunt', grunt);
      this.cacheFrames('hero', hero, HERO_ROWS.length);
      this.cacheFrames('grunt', grunt, GRUNT_ROWS.length);
      this.artReady = true;
    } catch (error) {
      // 资源导入失败时保留几何兜底，原生构建仍然可用于验证战斗与触控。
      console.error('[FrontierPoc] action sheets unavailable', error);
    }
  }

  private loadTexture(path: string): Promise<Texture2D> {
    return new Promise((resolve, reject) => {
      resources.load(path, Texture2D, (error, texture) => {
        if (error) reject(error);
        else resolve(texture);
      });
    });
  }

  private cacheFrames(key: string, texture: Texture2D, rows: number): void {
    const frames: SpriteFrame[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const frame = new SpriteFrame();
        frame.texture = texture;
        frame.rect = new Rect(column * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        frames.push(frame);
      }
    }
    this.spriteFrames.set(key, frames);
  }

  private syncEntitySprites(): void {
    if (!this.artReady) return;
    const alive = new Set<number>();
    const renderOrder: Array<{ node: Node; depth: number }> = [];
    for (const entity of this.run.world.entities) {
      if (entity.dead || (entity.team === 'enemy' && entity.kind !== 'grunt')) continue;
      alive.add(entity.id);
      const key = entity.team === 'player' ? 'hero' : 'grunt';
      const node = this.spriteNodes.get(entity.id) ?? this.createSpriteNode(entity.id, key);
      const sprite = node.getComponent(Sprite);
      const rows = key === 'hero' ? HERO_ROWS : GRUNT_ROWS;
      const action = this.resolveSpriteAction(key, entity.action);
      const row = Math.max(0, rows.indexOf(action as never));
      const definition = resolveAction(entity.action, entity.profession, entity.weapon);
      const progress = definition.loop
        ? (entity.actionFrame % definition.frames) / definition.frames
        : Math.min(1, entity.actionFrame / definition.frames);
      const column = Math.min(3, Math.floor(progress * 4));
      if (sprite) sprite.spriteFrame = this.spriteFrames.get(key)?.[row * 4 + column] ?? null;
      const point = this.worldToScreen(entity.pos.x, entity.pos.y);
      node.setPosition(point.x, point.y, 0);
      node.setScale(entity.facing * 1.15, 1.15, 1);
      node.active = true;
      renderOrder.push({ node, depth: entity.pos.y });
    }
    for (const [id, node] of this.spriteNodes) {
      if (alive.has(id)) continue;
      node.destroy();
      this.spriteNodes.delete(id);
    }
    renderOrder.sort((left, right) => left.depth - right.depth);
    renderOrder.forEach(({ node }, index) => node.setSiblingIndex(index));
  }

  private createSpriteNode(id: number, key: string): Node {
    const node = new Node(`${key}-${id}`);
    const transform = node.addComponent(UITransform);
    transform.setContentSize(CELL_SIZE, CELL_SIZE);
    // 动作表脚底固定在格内 y=90；锚点注册到同一行，切动作时不会上下跳。
    transform.setAnchorPoint(0.5, 1 - SPRITE_BASELINE / CELL_SIZE);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.node.addChild(node);
    this.spriteNodes.set(id, node);
    return node;
  }

  private resolveSpriteAction(key: string, action: string): string {
    const rows = key === 'hero' ? HERO_ROWS : GRUNT_ROWS;
    if ((rows as readonly string[]).includes(action)) return action;
    if (key === 'hero' && action === 'heavyCharge') return 'slash';
    if (
      key === 'hero'
      && ['slash3', 'heavyCharged', 'arcanePulse', 'skill', 'execute', 'airSlash'].includes(action)
    ) return 'slash2';
    if (action === 'jump') return 'move';
    const warningKey = `${key}:${action}`;
    if (!this.warnedActions.has(warningKey)) {
      this.warnedActions.add(warningKey);
      console.warn(`[FrontierPoc] unmapped sprite action ${warningKey}, using idle`);
    }
    return 'idle';
  }

  private onGameHide(): void {
    this.paused = true;
    this.joystickTouchId = null;
    this.actionTouches.clear();
    this.input.moveX = 0;
    this.input.moveY = 0;
    this.input.attack = false;
    this.input.attackHeld = false;
    this.input.dash = false;
    this.input.skill = false;
    this.input.execute = false;
    this.input.jump = false;
  }

  private onGameShow(): void {
    // 后台停留时间不能进入模拟；恢复时从一帧干净的时钟重新开始。
    this.clock.reset();
    this.paused = false;
  }

  private worldToScreen(x: number, y: number): { x: number; y: number } {
    const arena = this.run.world.arena;
    return {
      x: ((x - arena.minX) / (arena.maxX - arena.minX)) * (DESIGN_WIDTH - 64) - DESIGN_WIDTH / 2 + 32,
      y: ((y - arena.minY) / (arena.maxY - arena.minY))
        * (DESIGN_HEIGHT - CONTROL_HEIGHT - 80)
        - DESIGN_HEIGHT / 2
        + CONTROL_HEIGHT
        + 40,
    };
  }
}
