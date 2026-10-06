# 动作关键姿态生成记录

## archer 武器边界修正 v2

Reference: mossfeather-shot-keyposes-v1.png

Use case: identity-preserve. Edit target is this four-pose archer sheet. Preserve these exact four poses, character identity, bird face, green feather cloak, cream tunic, bow and arrow states, right-facing camera and 2x2 layout. Fix canvas framing: the top-right drawn bow tip is cut by the upper image edge. Repaint its complete upper bow tip and complete string attachment. Reduce ALL four characters together to about 80 percent of their current size, same uniform camera/body scale for every pose, so there is substantial transparent margin above each complete bow and below feet, and transparent gutters separating figures. Do not change any action or introduce arrows in bottom row. Genuine transparent background. All bow tips fully visible, no part touches image edges, no words, no border or shadow. Full correct longbow curves and string: top-right full draw, string V pulled to cheek, arrow horizontal to right.

路线：Codex 内置 imagegen 生成透明图集，显式检查布局后通过 asset_bundle 导出草稿；未使用付费 API、视频、骨骼拼接。身份获用户“可以继续”认可，动作用户验收待定。

## 近战移动 v1

Reference: redmane-blade-v2.png

Use case: identity-preserve. Asset type: transparent 2D game sprite key-pose sheet. Reference image is approved identity ONLY: preserve wolf face, red-orange mane, slate blue skin, bronze shoulder armor, cream wraps, orange sash and ONE curved dao held in the near hand. Preserve bright readable painterly rendering and exact body proportions. All poses face right with same slight three-quarter orthographic camera, no rotation toward viewer. Produce exactly four complete isolated figures arranged as two rows by two columns on genuine transparent background. Each figure occupies at most 70 percent of its quadrant, with ample clear margins for blade and feet, no overlap. Same body height and camera scale in all four cells, same ground baseline within each row. No labels, no frames, no shadows, no glow, no extra limbs or weapons. Action: a complete alternating forward walk cycle, carrying blade low angled forward in relaxed near hand. Top left: near leg steps forward and heel touches floor, far leg extends backward. Top right: near leg supports weight below pelvis while far knee swings forward, far foot lifted. Bottom left: far leg steps forward touches floor, near leg extends backward. Bottom right: far leg supports weight below pelvis while near knee swings forward, near foot lifted. The legs must visibly exchange front and back positions across opposite half cycles; not four identical wide stances. Small natural arm, mane and sash follow-through. Four readable key poses, full feet and sword intact.

## 近战挥刀 v1

Reference: redmane-blade-v2.png

Use case: identity-preserve. Asset type: transparent 2D game sprite key-pose sheet. Reference image is approved identity ONLY: preserve wolf face, red-orange mane, slate blue skin, bronze shoulder armor, cream wraps, orange sash and ONE curved dao held in the near hand. Preserve bright readable painterly rendering and exact body proportions. All poses face right with same slight three-quarter orthographic camera, no rotation toward viewer. Produce exactly four complete isolated figures arranged as two rows by two columns on genuine transparent background. Each figure occupies at most 70 percent of its quadrant, with ample clear margins for blade and feet, no overlap. Same body height and camera scale in all four cells, same ground baseline within each row. No labels, no frames, no shadows, no glow, no extra limbs or weapons. Action: one heavy rightward sword slash with planted feet. Top left: clear anticipation, knees flexed, torso twisted back, sword held raised behind shoulder ready to strike. Top right: decisive contact pose, torso turns right, sword extends forward at chest height, near arm extended. Bottom left: follow-through, blade sweeps lower diagonally forward, weight on forward foot. Bottom right: recovery toward the approved low guard idle stance, knees relaxed, sword lowered forward. No slash trails or effects. Keep hilt connected to same near hand in all poses, exactly one sword per character. Keep face and costume consistent despite pose changes.

## 移动下半周期修正 v2

Reference: redmane-move-keyposes-v1.png

Use case: identity-preserve. Edit target: attached four-pose walking sheet. Preserve all four figures' head, mane, face, armor, torso, arms, blade and rendering, preserve grid layout, transparency and camera/body scale. Correct ONLY the lower-body walking phases so this becomes an alternating cycle. Top left near-side leg is forward in contact, far-side leg behind. Top right near-side leg is the vertical planted support, far-side knee swings up and forward. Bottom left MUST exchange leg positions compared with top left: near-side leg reaches BACK toward the left, far-side leg reaches FORWARD toward the right; show clear crossing at hips and near-side boot behind, not the same wide stance as top left. Bottom right far-side leg is planted support, near-side knee swings forward toward right, not the same tucked pose as top right. Preserve same leg armor identity and coherent anatomy. Single connected body each cell, no extra legs, no text, no shadows; do not change costume. Keep full blade and every foot inside canvas with margins. The main requested change is visibly opposite near/far legs in bottom row.

## archer 攻击 v1

Reference: mossfeather-archer-v2.png

Use case: identity-preserve. Transparent 2D game attack key-pose sheet. Reference constrains exact approved identity, costume, bright painterly style and body proportions. Exactly FOUR complete isolated figures in a 2 by 2 sheet, same right-facing slight three-quarter orthographic camera and body scale, figures fill at most 70 percent of each quadrant with full weapons/feet and clear margins. No lettering, no frames, no shadows, no extra limbs. Preserve bird beak face, green feather cloak, cream tunic, talon feet, honey wood longbow and quiver. Sequence top-left nocks ONE arrow onto string; top-right full draw, bow hand straight forward to right, draw hand at cheek, visibly bent bow and taut string in V with arrow horizontal pointing right; bottom-left releases, same forward bow arm, draw fingers open beside cheek, bow string returns straight, arrow no longer in hands; bottom-right lowers bow and returns to guard with free empty hand, no arrow on string. Physically coherent bow: one continuous bow stave, one string connecting tips and drawn by hand, arrow rests near bow grip. No airborne arrows or effects. Keep longbow size constant.

## mage 攻击 v1

Reference: whitemask-lantern-mage-v2.png

Use case: identity-preserve. Transparent 2D game attack key-pose sheet. Reference constrains exact approved identity, costume, bright painterly style and body proportions. Exactly FOUR complete isolated figures in a 2 by 2 sheet, same right-facing slight three-quarter orthographic camera and body scale, figures fill at most 70 percent of each quadrant with full weapons/feet and clear margins. No lettering, no frames, no shadows, no extra limbs. Preserve white porcelain mask, high narrow ritual hat, ivory long robe with violet panels and talismans, ONE crooked staff with cyan paper lantern. Sequence top-left lifts free hand in preparation while staff upright; top-right raises staff and lantern above head, free hand makes clear casting gesture toward right; bottom-left pushes staff slightly forward and free hand points down and forward at fixed ground target; bottom-right exhausted recovery with shoulders lowered and staff returned upright, free arm lowers. Maintain lantern attached to same staff tip, mask unchanged, no extra objects, no generated floor spell, no magical glow trails. Keep full robe and staff intact.
