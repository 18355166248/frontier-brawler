import {
  Color,
  Component,
  EventKeyboard,
  EventTouch,
  Game,
  Graphics,
  Input,
  KeyCode,
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
  input,
  resources,
  sys,
  view,
} from 'cc';
import {
  EMPTY_INPUT,
  ACCESSORIES,
  ARMORS,
  COCOS_BOSS_ROWS,
  COCOS_GRUNT_ROWS,
  COCOS_HERO_ROWS,
  FixedStepClock,
  Run,
  STAGES,
  TICK_RATE,
  UPGRADE_TRACKS,
  WEAPONS,
  createProfile,
  clampCocosCameraX,
  resolveAction,
  resolveCocosSpriteAction,
  worldToCocosScreen,
  type PocEquipmentId,
  type PocProfession,
} from './FrontierCoreAdapter';

const { ccclass } = _decorator;
const DESIGN_WIDTH = 540;
const DESIGN_HEIGHT = 960;
const CONTROL_HEIGHT = 250;
const CAMERA_DEADZONE_X = 70;
const CAMERA_FOLLOW_RATE = 9;
const CELL_SIZE = 96;
const SPRITE_BASELINE = 90;
const HERO_ROWS = COCOS_HERO_ROWS;
const GRUNT_ROWS = COCOS_GRUNT_ROWS;
const BOSS_ROWS = COCOS_BOSS_ROWS;
const BACKGROUND_COLOR = new Color(9, 13, 16, 255);
const ARENA_COLOR = new Color(20, 27, 31, 255);
const PLAYER_COLOR = new Color(72, 205, 175, 255);
const ENEMY_COLOR = new Color(224, 83, 74, 255);
const CONTROL_BORDER_COLOR = new Color(120, 136, 143, 200);
const HUD_TRACK_COLOR = new Color(35, 45, 50, 235);
const HP_COLOR = new Color(221, 77, 68, 255);
const ENERGY_COLOR = new Color(63, 180, 217, 255);
const UI_TEXT_COLOR = new Color(231, 238, 239, 255);
const OVERLAY_COLOR = new Color(7, 11, 14, 228);
const BOSS_PHASE_TWO_TINT = new Color(255, 151, 104, 255);
const SPRITE_WHITE = new Color(255, 255, 255, 255);

type ActionKey = 'attack' | 'dash' | 'skill' | 'execute' | 'jump';

const PROFESSIONS: readonly PocProfession[] = ['heavy', 'swift', 'arcane'];
const PROFESSION_LABELS: Record<PocProfession, string> = {
  heavy: '重击',
  swift: '疾锋',
  arcane: '术法',
};
const KEYBOARD_ACTIONS = new Map<KeyCode, ActionKey>([
  [KeyCode.KEY_J, 'attack'],
  [KeyCode.SPACE, 'attack'],
  [KeyCode.KEY_K, 'dash'],
  [KeyCode.SHIFT_LEFT, 'dash'],
  [KeyCode.KEY_U, 'skill'],
  [KeyCode.KEY_E, 'skill'],
  [KeyCode.KEY_I, 'execute'],
  [KeyCode.KEY_F, 'execute'],
  [KeyCode.KEY_L, 'jump'],
  [KeyCode.KEY_Q, 'jump'],
]);

// 共享逻辑通过本地 npm 包进入 Creator，避免维护一份会逐渐分叉的 core 副本。

/**
 * 第一阶段只验证三件事：现有 core 能被 Creator 加载、原生 update(dt) 仍按
 * 固定 60Hz 推进、竖屏触控不会遮住战场。正式精灵与完整 HUD 在这三项通过后接入。
 */
@ccclass('FrontierPoc')
export class FrontierPoc extends Component {
  private readonly clock = new FixedStepClock({ tickRate: TICK_RATE });
  private run = new Run(STAGES[0], createProfile());
  private input = { ...EMPTY_INPUT };
  private graphics: Graphics | null = null;
  private hudNode: Node | null = null;
  private hudGraphics: Graphics | null = null;
  private statusLabel: Label | null = null;
  private hintLabel: Label | null = null;
  private overlayLabel: Label | null = null;
  private readonly upperActionLabels: Label[] = [];
  private dashLabel: Label | null = null;
  private attackLabel: Label | null = null;
  private lastHudSignature = '';
  private lastPhase = '';
  private hudStatusY = 452;
  private cameraX = 480;
  private controlLift = 0;
  private safeAreaRefreshFrames = 120;
  private joystickTouchId: number | null = null;
  private joystickOrigin = new Vec2();
  private touchMoveX = 0;
  private touchMoveY = 0;
  private readonly actionTouches = new Map<number, ActionKey>();
  private readonly keyboardKeys = new Set<KeyCode>();
  private readonly spriteFrames = new Map<string, SpriteFrame[]>();
  private readonly textures = new Map<string, Texture2D>();
  private readonly spriteNodes = new Map<number, Node>();
  private readonly warnedActions = new Set<string>();
  private artReady = false;
  private paused = false;
  private disposed = false;

  onLoad(): void {
    view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, ResolutionPolicy.SHOW_ALL);
    this.updateSafeArea();
    // 起始房是无敌人的出发点；POC 直接进入 v1，确保验证到实体更新与敌人 AI。
    this.run.enterRoom('v1', null);
    this.snapCameraToPlayer();
    this.graphics = this.getOrCreateGraphics();
    this.createHud();
    void this.loadActionSheets();
    this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
    this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    game.on(Game.EVENT_HIDE, this.onGameHide, this);
    game.on(Game.EVENT_SHOW, this.onGameShow, this);
  }

  onDestroy(): void {
    // 原生场景切换时必须解除监听；否则重新进入场景会让一次触摸被消费多次。
    this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
    this.node.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
    this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
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
    if (this.safeAreaRefreshFrames > 0) {
      this.safeAreaRefreshFrames -= 1;
      if (this.safeAreaRefreshFrames % 15 === 0) this.updateSafeArea();
    }
    this.releaseInputWhenOverlayOpens();
    // attackHeld 是跨帧电平；只有 attack 等动作触发字段是单次按下沿。
    this.refreshAttackHeld();
    this.clock.consume(deltaTime * 1000, this.paused, () => {
      this.run.step(this.input);
      // 动作键是按下沿；每个渲染帧最多只允许逻辑层消费一次。
      this.input.attack = false;
      this.input.dash = false;
      this.input.skill = false;
      this.input.execute = false;
      this.input.jump = false;
    });
    this.updateCamera(deltaTime);
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
    if (point.y < this.controlLift || point.y > CONTROL_HEIGHT + this.controlLift) return;
    if (
      point.x >= DESIGN_WIDTH * 0.48
      && (this.run.phase === 'stageComplete' || this.run.phase === 'dead')
    ) {
      this.restartStage();
      return;
    }
    if (
      this.run.phase === 'professionSelect'
      || this.run.pendingChoice
      || this.run.pendingEquipment
    ) {
      this.handleOverlaySelection(point.x, point.y);
      return;
    }
    if (point.x < DESIGN_WIDTH * 0.48 && this.joystickTouchId === null) {
      this.joystickTouchId = event.getID();
      this.joystickOrigin.set(point.x, point.y);
      return;
    }
    if (this.handleOverlaySelection(point.x, point.y)) return;
    this.pressAction(event.getID(), point.x, point.y);
  }

  private handleOverlaySelection(x: number, y: number): boolean {
    if (
      this.run.phase !== 'professionSelect'
      && !this.run.pendingChoice
      && !this.run.pendingEquipment
    ) return false;
    const upperCenterY = CONTROL_HEIGHT * 0.75 + this.controlLift;
    if (Math.abs(y - upperCenterY) > 46 || x < DESIGN_WIDTH * 0.48) return true;
    const centers = [306, 400, 494];
    const column = centers.findIndex((center) => Math.abs(x - center) <= 46);
    if (column < 0) return true;
    if (this.run.phase === 'professionSelect') {
      this.selectProfession(column);
      return true;
    }
    if (this.run.pendingChoice) {
      const choice = this.run.pendingChoice[column];
      if (choice) this.run.chooseUpgrade(choice);
      return true;
    }
    if (this.run.pendingEquipment) {
      const choice = this.run.pendingEquipment[column];
      if (choice) this.run.chooseEquipment(choice);
      return true;
    }
    return this.run.phase === 'stageComplete' || this.run.phase === 'dead';
  }

  private selectProfession(index: number): void {
    const profession = PROFESSIONS[index];
    if (profession && this.run.availableProfessions.includes(profession)) {
      this.run.setProfession(profession);
    }
  }

  private onTouchMove(event: EventTouch): void {
    if (event.getID() !== this.joystickTouchId) return;
    const point = event.getUILocation();
    const dx = point.x - this.joystickOrigin.x;
    const dy = point.y - this.joystickOrigin.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const scale = Math.min(1, length / 72);
    this.touchMoveX = (dx / length) * scale;
    this.touchMoveY = (dy / length) * scale;
    this.refreshMovement();
  }

  private onTouchEnd(event: EventTouch): void {
    const touchId = event.getID();
    if (touchId === this.joystickTouchId) {
      this.joystickTouchId = null;
      this.touchMoveX = 0;
      this.touchMoveY = 0;
      this.refreshMovement();
    }
    this.actionTouches.delete(touchId);
    this.refreshAttackHeld();
  }

  private onKeyDown(event: EventKeyboard): void {
    const key = event.keyCode;
    const firstPress = !this.keyboardKeys.has(key);
    this.keyboardKeys.add(key);
    this.refreshMovement();
    this.refreshAttackHeld();
    if (!firstPress) return;

    if (key === KeyCode.KEY_R && (this.run.phase === 'stageComplete' || this.run.phase === 'dead')) {
      this.restartStage();
      return;
    }
    const choiceIndex = this.choiceIndexForKey(key);
    if (choiceIndex >= 0 && this.handleKeyboardChoice(choiceIndex)) return;
    if (
      this.run.phase === 'professionSelect'
      || this.run.pendingChoice
      || this.run.pendingEquipment
      || this.run.phase === 'stageComplete'
      || this.run.phase === 'dead'
    ) return;

    const action = KEYBOARD_ACTIONS.get(key);
    if (!action) return;
    this.input[action] = true;
  }

  private onKeyUp(event: EventKeyboard): void {
    this.keyboardKeys.delete(event.keyCode);
    this.refreshMovement();
    this.refreshAttackHeld();
  }

  private choiceIndexForKey(key: KeyCode): number {
    if (key === KeyCode.DIGIT_1 || key === KeyCode.NUM_1) return 0;
    if (key === KeyCode.DIGIT_2 || key === KeyCode.NUM_2) return 1;
    if (key === KeyCode.DIGIT_3 || key === KeyCode.NUM_3) return 2;
    return -1;
  }

  private handleKeyboardChoice(index: number): boolean {
    if (this.run.phase === 'professionSelect') {
      this.selectProfession(index);
      return true;
    }
    if (this.run.pendingChoice) {
      const choice = this.run.pendingChoice[index];
      if (choice) this.run.chooseUpgrade(choice);
      return true;
    }
    if (this.run.pendingEquipment) {
      const choice = this.run.pendingEquipment[index];
      if (choice) this.run.chooseEquipment(choice);
      return true;
    }
    return false;
  }

  private refreshMovement(): void {
    const keyboardX = Number(
      this.keyboardKeys.has(KeyCode.KEY_D) || this.keyboardKeys.has(KeyCode.ARROW_RIGHT),
    ) - Number(
      this.keyboardKeys.has(KeyCode.KEY_A) || this.keyboardKeys.has(KeyCode.ARROW_LEFT),
    );
    const keyboardY = Number(
      this.keyboardKeys.has(KeyCode.KEY_W) || this.keyboardKeys.has(KeyCode.ARROW_UP),
    ) - Number(
      this.keyboardKeys.has(KeyCode.KEY_S) || this.keyboardKeys.has(KeyCode.ARROW_DOWN),
    );
    const x = this.touchMoveX + keyboardX;
    const y = this.touchMoveY + keyboardY;
    const length = Math.max(1, Math.hypot(x, y));
    this.input.moveX = x / length;
    this.input.moveY = y / length;
  }

  private refreshAttackHeld(): void {
    this.input.attackHeld = [...this.actionTouches.values()].includes('attack')
      || this.keyboardKeys.has(KeyCode.KEY_J)
      || this.keyboardKeys.has(KeyCode.SPACE);
  }

  private pressAction(touchId: number, x: number, y: number): void {
    const column = Math.max(0, Math.min(2, Math.floor((x - DESIGN_WIDTH * 0.48) / 94)));
    const upper = y > CONTROL_HEIGHT / 2 + this.controlLift;
    let action: ActionKey;
    if (upper && column === 0) action = 'jump';
    else if (upper && column === 1) action = 'skill';
    else if (upper) action = 'execute';
    else if (column === 0) action = 'dash';
    else action = 'attack';
    this.actionTouches.set(touchId, action);
    this.input[action] = true;
    this.refreshAttackHeld();
  }

  private drawDebugWorld(): void {
    const graphics = this.graphics;
    const hudGraphics = this.hudGraphics;
    if (!graphics || !hudGraphics) return;
    graphics.clear();
    hudGraphics.clear();
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

    hudGraphics.strokeColor = CONTROL_BORDER_COLOR;
    hudGraphics.lineWidth = 2;
    hudGraphics.rect(
      -DESIGN_WIDTH / 2,
      -DESIGN_HEIGHT / 2 + this.controlLift,
      DESIGN_WIDTH,
      CONTROL_HEIGHT,
    );
    hudGraphics.stroke();

    // 控件轮廓与真实触摸热区使用同一组常量，避免“看得到却按不到”。
    hudGraphics.circle(-140, -355 + this.controlLift, 72);
    hudGraphics.stroke();
    hudGraphics.circle(
      -140 + this.input.moveX * 38,
      -355 + this.controlLift + this.input.moveY * 38,
      30,
    );
    hudGraphics.stroke();
    for (const x of [36, 130, 224]) {
      hudGraphics.circle(x, -292 + this.controlLift, 38);
      hudGraphics.stroke();
    }
    hudGraphics.circle(36, -417 + this.controlLift, 38);
    hudGraphics.stroke();
    hudGraphics.rect(83, -455 + this.controlLift, 181, 76);
    hudGraphics.stroke();

    const player = this.run.world.entities.find((entity) => entity.team === 'player');
    if (player) {
      this.drawBar(hudGraphics, -250, this.hudStatusY - 26, 300, 18, player.hp / player.maxHp, HP_COLOR);
      this.drawBar(hudGraphics, -250, this.hudStatusY - 52, 220, 12, player.energy / player.maxEnergy, ENERGY_COLOR);
    }
    if (['professionSelect', 'choosing', 'equipmentChoice', 'stageComplete', 'dead'].includes(this.run.phase)) {
      hudGraphics.fillColor = OVERLAY_COLOR;
      hudGraphics.rect(-250, 80, 500, 250);
      hudGraphics.fill();
    }
    if (this.run.openDoors.includes('east')) {
      const arena = this.run.world.arena;
      const door = this.worldToScreen(arena.maxX, (arena.minY + arena.maxY) / 2);
      graphics.strokeColor = ENERGY_COLOR;
      graphics.lineWidth = 5;
      graphics.rect(door.x - 9, door.y - 70, 18, 140);
      graphics.stroke();
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
    this.hudNode = new Node('hud-layer');
    const transform = this.hudNode.addComponent(UITransform);
    transform.setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    this.hudGraphics = this.hudNode.addComponent(Graphics);
    this.node.addChild(this.hudNode);
    this.statusLabel = this.createLabel('status', -250, this.hudStatusY, 20, 330);
    this.hintLabel = this.createLabel('hint', 70, this.hudStatusY - 27, 18, 190);
    this.overlayLabel = this.createLabel('overlay', -220, 230, 24, 440);
    this.upperActionLabels.push(
      this.createLabel('jump', 18, -300 + this.controlLift, 18),
      this.createLabel('skill', 112, -300 + this.controlLift, 18),
      this.createLabel('execute', 206, -300 + this.controlLift, 18),
    );
    this.dashLabel = this.createLabel('dash', 18, -425 + this.controlLift, 18);
    this.dashLabel.string = '闪';
    this.attackLabel = this.createLabel('attack', 145, -425 + this.controlLift, 20);
    this.attackLabel.string = '攻击';
  }

  private createLabel(name: string, x: number, y: number, fontSize: number, width = 100): Label {
    const node = new Node(name);
    const transform = node.addComponent(UITransform);
    transform.setContentSize(width, name === 'overlay' ? 180 : 32);
    transform.setAnchorPoint(0, 0.5);
    const label = node.addComponent(Label);
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 4;
    label.color = UI_TEXT_COLOR;
    node.setPosition(x, y, 0);
    (this.hudNode ?? this.node).addChild(node);
    return label;
  }

  private updateHud(): void {
    const player = this.run.world.entities.find((entity) => entity.team === 'player');
    const enemies = this.run.world.entities.filter(
      (entity) => entity.team === 'enemy' && !entity.dead,
    ).length;
    const signature = [
      this.run.phase,
      this.run.room.id,
      player ? Math.ceil(player.hp) : 0,
      player ? Math.floor(player.energy) : 0,
      enemies,
      this.run.pendingChoice?.join(','),
      this.run.pendingEquipment?.join(','),
    ].join('|');
    if (signature === this.lastHudSignature) return;
    this.lastHudSignature = signature;
    if (this.statusLabel && player) {
      this.statusLabel.string = `生命 ${Math.ceil(player.hp)}/${Math.ceil(player.maxHp)}  ·  能量 ${Math.floor(player.energy)}`;
    }
    if (this.hintLabel) {
      const phaseText = this.run.phase === 'cleared' ? '向右进入下一房' : `${enemies} 名敌人`;
      this.hintLabel.string = `${this.run.room.id}  ${phaseText}`;
    }
    this.updateOverlay();
  }

  private updateOverlay(): void {
    if (!this.overlayLabel) return;
    const choices = this.run.pendingChoice;
    const equipment = this.run.pendingEquipment;
    if (this.run.phase === 'professionSelect') {
      const available = new Set(this.run.availableProfessions);
      this.overlayLabel.string = `选择职业 · 键盘 1/2/3\n${PROFESSIONS.map((id, index) => `${index + 1} ${PROFESSION_LABELS[id]}${available.has(id) ? '' : '（需演武场）'}`).join('\n')}`;
      this.setUpperLabels(PROFESSIONS.map((id) => available.has(id) ? PROFESSION_LABELS[id] : '锁定'));
      return;
    }
    if (choices) {
      this.overlayLabel.string = `选择一项成长\n${choices.map((id) => `${UPGRADE_TRACKS[id].label} · ${UPGRADE_TRACKS[id].theme}`).join('\n')}`;
      this.setUpperLabels(choices.map((id) => UPGRADE_TRACKS[id].label));
      return;
    }
    if (equipment) {
      this.overlayLabel.string = `选择一件战利品\n${equipment.map((id) => this.equipmentLabel(id)).join('\n')}`;
      this.setUpperLabels(equipment.map((id) => this.equipmentLabel(id).slice(0, 2)));
      return;
    }
    if (this.run.phase === 'stageComplete') {
      this.overlayLabel.string = '荒村 已通关\n点击右侧按钮重新挑战';
      this.setUpperLabels(['重', '新', '开']);
      return;
    }
    if (this.run.phase === 'dead') {
      this.overlayLabel.string = '战败\n点击右侧按钮重新挑战';
      this.setUpperLabels(['重', '试', '再']);
      return;
    }
    this.overlayLabel.string = '';
    this.setUpperLabels(['跃', '技', '决']);
  }

  private setUpperLabels(labels: string[]): void {
    this.upperActionLabels.forEach((label, index) => {
      label.string = labels[index] ?? '—';
    });
  }

  private equipmentLabel(id: PocEquipmentId): string {
    return WEAPONS[id]?.label ?? ARMORS[id]?.label ?? ACCESSORIES[id]?.label ?? id;
  }

  private releaseInputWhenOverlayOpens(): void {
    const phase = this.run.phase;
    if (
      phase !== this.lastPhase
      && ['professionSelect', 'choosing', 'equipmentChoice', 'stageComplete', 'dead'].includes(phase)
    ) this.clearInput();
    this.lastPhase = phase;
  }

  private updateSafeArea(): void {
    const safeArea = sys.getSafeAreaRect(false);
    const visibleSize = view.getVisibleSize();
    // 原生 cutout 可能在启动后异步下发，因此前两秒会周期重读，而不是只信 onLoad 首帧。
    const topInset = Math.max(0, visibleSize.height - safeArea.y - safeArea.height);
    this.hudStatusY = DESIGN_HEIGHT / 2 - topInset - 28;
    // 底部手势区只抬升交互层，背景继续铺满；限制幅度避免侵占战斗视口。
    this.controlLift = Math.min(28, Math.max(0, safeArea.y));
    this.statusLabel?.node.setPosition(-250, this.hudStatusY, 0);
    this.hintLabel?.node.setPosition(70, this.hudStatusY - 27, 0);
    this.upperActionLabels.forEach((label, index) => {
      label.node.setPosition(18 + index * 94, -300 + this.controlLift, 0);
    });
    this.dashLabel?.node.setPosition(18, -425 + this.controlLift, 0);
    this.attackLabel?.node.setPosition(145, -425 + this.controlLift, 0);
  }

  private updateCamera(deltaTime: number): void {
    const player = this.run.player;
    if (!player) return;
    let target = this.cameraX;
    if (player.pos.x < this.cameraX - CAMERA_DEADZONE_X) {
      target = player.pos.x + CAMERA_DEADZONE_X;
    } else if (player.pos.x > this.cameraX + CAMERA_DEADZONE_X) {
      target = player.pos.x - CAMERA_DEADZONE_X;
    }
    target = this.clampCameraX(target);
    // 指数平滑与显示帧率无关，且在逻辑更新之后执行，避免一帧跟随抖动。
    const follow = 1 - Math.exp(-CAMERA_FOLLOW_RATE * Math.max(0, deltaTime));
    this.cameraX += (target - this.cameraX) * follow;
  }

  private snapCameraToPlayer(): void {
    const playerX = this.run.player?.pos.x ?? (this.run.world.arena.minX + this.run.world.arena.maxX) / 2;
    this.cameraX = this.clampCameraX(playerX);
  }

  private clampCameraX(x: number): number {
    const arena = this.run.world.arena;
    return clampCocosCameraX(x, arena);
  }

  private restartStage(): void {
    // 原生重试替换整局状态，确保房间清空、奖励与 AI 私有计时一起归零。
    this.run = new Run(STAGES[0], createProfile());
    this.run.enterRoom('v1', null);
    this.snapCameraToPlayer();
    this.clock.reset();
    this.clearInput();
    for (const node of this.spriteNodes.values()) node.destroy();
    this.spriteNodes.clear();
    this.lastHudSignature = '';
    this.lastPhase = '';
  }

  private async loadActionSheets(): Promise<void> {
    try {
      const [hero, grunt, boss] = await Promise.all([
        this.loadTexture('generated-art/hero-v2/texture'),
        this.loadTexture('generated-art/enemy-grunt-v2/texture'),
        this.loadTexture('generated-art/enemy-boss-v2/texture'),
      ]);
      if (this.disposed || !this.isValid) return;
      hero.addRef();
      grunt.addRef();
      boss.addRef();
      this.textures.set('hero', hero);
      this.textures.set('grunt', grunt);
      this.textures.set('boss', boss);
      this.cacheFrames('hero', hero, HERO_ROWS.length);
      this.cacheFrames('grunt', grunt, GRUNT_ROWS.length);
      this.cacheFrames('boss', boss, BOSS_ROWS.length);
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
      if (
        entity.dead
        || (entity.team === 'enemy' && entity.kind !== 'grunt' && entity.kind !== 'boss')
      ) continue;
      alive.add(entity.id);
      const key = entity.team === 'player' ? 'hero' : entity.kind === 'boss' ? 'boss' : 'grunt';
      const node = this.spriteNodes.get(entity.id) ?? this.createSpriteNode(entity.id, key);
      const sprite = node.getComponent(Sprite);
      const rows = key === 'hero' ? HERO_ROWS : key === 'boss' ? BOSS_ROWS : GRUNT_ROWS;
      const action = this.resolveSpriteAction(key, entity.action);
      const row = Math.max(0, rows.indexOf(action as never));
      const definition = resolveAction(entity.action, entity.profession, entity.weapon);
      const progress = definition.loop
        ? (entity.actionFrame % definition.frames) / definition.frames
        : Math.min(1, entity.actionFrame / definition.frames);
      const column = Math.min(3, Math.floor(progress * 4));
      if (sprite) {
        sprite.spriteFrame = this.spriteFrames.get(key)?.[row * 4 + column] ?? null;
        sprite.color = key === 'boss' && entity.ai.bossPhase === 2
          ? BOSS_PHASE_TWO_TINT
          : SPRITE_WHITE;
      }
      const point = this.worldToScreen(entity.pos.x, entity.pos.y);
      node.setPosition(point.x, point.y, 0);
      const scale = key === 'boss' ? 1.55 : 1.15;
      node.setScale(entity.facing * scale, scale, 1);
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
    const resolved = resolveCocosSpriteAction(key as 'hero' | 'grunt' | 'boss', action);
    if (!resolved.fallback) return resolved.row;
    const warningKey = `${key}:${action}`;
    if (!this.warnedActions.has(warningKey)) {
      this.warnedActions.add(warningKey);
      console.warn(`[FrontierPoc] unmapped sprite action ${warningKey}, using idle`);
    }
    return resolved.row;
  }

  private onGameHide(): void {
    this.paused = true;
    this.clearInput();
  }

  private clearInput(): void {
    this.joystickTouchId = null;
    this.actionTouches.clear();
    this.keyboardKeys.clear();
    this.touchMoveX = 0;
    this.touchMoveY = 0;
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
    this.safeAreaRefreshFrames = 120;
    this.updateSafeArea();
    this.paused = false;
  }

  private worldToScreen(x: number, y: number): { x: number; y: number } {
    return worldToCocosScreen(x, y, this.cameraX, this.run.world.arena);
  }
}
