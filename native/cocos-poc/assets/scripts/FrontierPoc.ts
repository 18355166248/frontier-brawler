import {
  Color,
  Component,
  EventTouch,
  Graphics,
  Node,
  ResolutionPolicy,
  UITransform,
  Vec2,
  _decorator,
  view,
} from 'cc';
import {
  EMPTY_INPUT,
  FixedStepClock,
  Run,
  STAGES,
  TICK_RATE,
  createProfile,
} from '../generated/frontier-core';

const { ccclass } = _decorator;
const DESIGN_WIDTH = 540;
const DESIGN_HEIGHT = 960;
const CONTROL_HEIGHT = 250;

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
  private joystickTouchId: number | null = null;
  private joystickOrigin = new Vec2();

  onLoad(): void {
    view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, ResolutionPolicy.SHOW_ALL);
    this.run.setProfession('heavy');
    // 起始房是无敌人的出发点；POC 直接进入 v1，确保验证到实体更新与敌人 AI。
    this.run.enterRoom('v1', null);
    this.graphics = this.getOrCreateGraphics();
    this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
    this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
  }

  onDestroy(): void {
    // 原生场景切换时必须解除监听；否则重新进入场景会让一次触摸被消费多次。
    this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
    this.node.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
    this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
  }

  update(deltaTime: number): void {
    this.clock.consume(deltaTime * 1000, false, () => {
      this.run.step(this.input);
      // 动作键是按下沿；每个渲染帧最多只允许逻辑层消费一次。
      this.input.attack = false;
      this.input.attackHeld = false;
      this.input.dash = false;
      this.input.skill = false;
      this.input.execute = false;
      this.input.jump = false;
    });
    this.drawDebugWorld();
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
    this.pressAction(point.x, point.y);
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
    if (event.getID() !== this.joystickTouchId) return;
    this.joystickTouchId = null;
    this.input.moveX = 0;
    this.input.moveY = 0;
  }

  private pressAction(x: number, y: number): void {
    const column = Math.max(0, Math.min(2, Math.floor((x - DESIGN_WIDTH * 0.48) / 94)));
    const upper = y > CONTROL_HEIGHT / 2;
    if (upper && column === 0) this.input.jump = true;
    else if (upper && column === 1) this.input.skill = true;
    else if (upper) this.input.execute = true;
    else if (column === 0) this.input.dash = true;
    else {
      this.input.attack = true;
      this.input.attackHeld = true;
    }
  }

  private drawDebugWorld(): void {
    const graphics = this.graphics;
    if (!graphics) return;
    graphics.clear();
    graphics.fillColor = new Color(9, 13, 16, 255);
    graphics.rect(-DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, DESIGN_WIDTH, DESIGN_HEIGHT);
    graphics.fill();
    graphics.fillColor = new Color(20, 27, 31, 255);
    graphics.rect(-DESIGN_WIDTH / 2 + 16, -DESIGN_HEIGHT / 2 + CONTROL_HEIGHT, DESIGN_WIDTH - 32, DESIGN_HEIGHT - CONTROL_HEIGHT - 16);
    graphics.fill();

    const arena = this.run.world.arena;
    for (const entity of this.run.world.entities) {
      if (entity.dead) continue;
      const x = ((entity.pos.x - arena.minX) / (arena.maxX - arena.minX)) * (DESIGN_WIDTH - 64) - DESIGN_WIDTH / 2 + 32;
      const y = ((entity.pos.y - arena.minY) / (arena.maxY - arena.minY)) * (DESIGN_HEIGHT - CONTROL_HEIGHT - 80) - DESIGN_HEIGHT / 2 + CONTROL_HEIGHT + 40;
      graphics.fillColor = entity.team === 'player'
        ? new Color(72, 205, 175, 255)
        : new Color(224, 83, 74, 255);
      graphics.circle(x, y, entity.team === 'player' ? 18 : 14);
      graphics.fill();
    }

    graphics.strokeColor = new Color(120, 136, 143, 200);
    graphics.lineWidth = 2;
    graphics.rect(-DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, DESIGN_WIDTH, CONTROL_HEIGHT);
    graphics.stroke();
  }
}
