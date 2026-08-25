# hero-v2 生成提示词

生成方式：内置 imagegen。每个动作单独生成一张方形 2×2 网格，所有调用都使用
`walk-4f-attempt-3-chroma-grid.png` 作为身份与风格参考图。

## 通用角色圣经与画布约束

```text
Use case: stylized-concept
Asset type: 2×2 source grid for a production game character animation
Input image: strict identity and style reference. Preserve exactly the same
low-poly frontier swordsman: angular brown hair silhouette, face, teal long
tunic with cream collar and cuffs, diagonal brown chest strap, square brass
belt buckle, brown forearm guards, dark charcoal trousers, brown boots, and the
same short straight sword and scabbard. No redesign or costume changes.

Canvas and background: one square 2×2 grid, exactly four equal square cells in
reading order, on a perfectly flat uniform solid #FF00FF chroma-key magenta
background. No visible grid, gutters, checkerboard, gradient, floor, shadow,
texture, text or watermark.

Camera and registration: fixed orthographic 3/4 side view facing screen-right,
approximately 62 degrees; identical camera, zoom, lighting, body proportions,
head size, character root coordinates and local ground baseline in all cells.
Full body visible with generous margins. No per-frame rescaling.

Rendering: polished clean low-poly cartoon 3D, crisp silhouette readable at
96px. Exactly one character per cell. Nothing crosses boundaries. No motion
blur, effects, extra limbs, duplicate weapons or extra props.
```

## idle

```text
Animation: IDLE breathing loop, four distinct but subtle key poses. Frame 1
neutral ready stance with sword sheathed. Frame 2 chest and shoulders rise
slightly while both feet stay planted. Frame 3 returns through neutral. Frame 4
shoulders settle slightly. Keep both boots on the exact same local baseline in
all four frames; no walking, weapon draw or body translation. The loop must
read as calm alert breathing, not four unrelated poses.
```

## move

```text
Animation: a strong seamless WALK CYCLE with four clearly different poses,
sword fully sheathed in every frame. Frame 1 left-foot contact: left heel
forward, right leg extended back, opposite arm swing. Frame 2 passing: rear foot
lifts beneath pelvis, planted leg nearly straight. Frame 3 right-foot contact,
exact mirrored stride and opposite arm swing. Frame 4 opposite passing pose.
Keep the character walking in place: pelvis at the same local x, planted boot
on the same baseline, identical body scale. Make the stride readable and
energetic but natural, not four near-identical poses.
```

## slash

```text
Animation: first combo attack, a forceful VERTICAL DOWNWARD SWORD SLASH in
exactly four readable key poses. Frame 1 grounded anticipation, right hand
drawing and raising the sword while feet remain planted. Frame 2 high overhead
wind-up with torso coiled. Frame 3 decisive downward impact toward screen-right,
sword fully extended with clear weight transfer. Frame 4 low follow-through and
recovery. The same single sword is in the right hand after being drawn; scabbard
remains on the hip and is empty. Keep the planted-foot ground baseline
identical; weapon may extend upward but body scale and head size must not
change. No energy effects.
```

## slash2

```text
Animation: second combo attack, a wide HORIZONTAL SWORD SWEEP in exactly four
readable key poses, clearly different from the vertical slash. Frame 1 low
coiled anticipation after the first strike. Frame 2 sword begins sweeping
across the torso. Frame 3 maximum horizontal extension toward screen-right with
a broad, powerful arc implied only by pose. Frame 4 rotated follow-through and
recovery. The same single sword stays in the right hand; scabbard remains on
the hip and is empty. Keep the planted-foot ground baseline identical; body
scale and head size must not change. No energy trails or effects.
```

第一次 slash2 的第四格缺剑，随后使用精确编辑：只修改右下格，在保持人物、姿势、
相机和其他三格不变的前提下，补齐握在右手、完整可见且不越界的同一把短直剑。

## dash

```text
Animation: fast grounded DASH in four readable key poses, sword fully sheathed
in every frame. Frame 1 compressed crouched anticipation with weight forward.
Frame 2 explosive launch toward screen-right, torso sharply leaning forward.
Frame 3 maximum-speed low streamlined pose with trailing leg extended and front
knee driving. Frame 4 braking recovery returning toward stance. Preserve the
same character and equipment. Keep scale and camera fixed; ground contacts
share the same local baseline where applicable. No speed lines, afterimages,
dust or effects—the body pose alone must communicate speed.
```

## hit

```text
Animation: HIT REACTION in four readable key poses, sword fully sheathed in
every frame. An invisible impact comes from screen-right. Frame 1 guarded
neutral stance. Frame 2 shoulders and head snap backward, torso recoils left,
arms react defensively. Frame 3 maximum stagger with knees bent and balance
clearly broken but both feet visible. Frame 4 controlled recovery toward
neutral. Preserve character identity, costume and equipment exactly. Keep fixed
scale, camera and ground baseline. No attacker, blood, impact flash, particles
or effects.
```
