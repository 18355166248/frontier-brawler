# 山路石木关隘（checkpoint-v3）

本任务使用OpenAI内置image_gen重新制作。门框为真实绘制的斜侧视角，具有石柱、屋檐、门洞内侧和短侧墙厚度；运行时未对门框作shear。它仍是2D贴图，不是3D模型。门框主形先在实际Godot场景给出预览，再接入栅门状态。没有宣称用户已经认可或素材已经手工精修。

3张RGBA运行PNG：gate-frame768×1024、portcullis512×1024、boss-pennant256×512。门框pivot(384,810)，世界scale0.2；栅门UV映射到契约中的门洞四边形，层序为栅门→门框→Boss旗→原生状态文字。画布/源hash/透明边缘/统一裁切缩放平移记录见[asset-contract.json](asset-contract.json)。所有外边缘alpha0，门洞采样alpha0。加工只裁切、等比缩放、透明填充，不通过程序补画素材。

原始生成输出保留在项目generated_images/；完整Prompt、弃选源、实际场景截图与PNG检查留在Git忽略的output/gate-redesign-20261004/。原门框源exec-a98f6aec-6b8a-4072-b434-d721f2732391.png；栅门源exec-ac3fecba-926b-48cf-967e-a23c1c3c840d.png；红旗源exec-8958c2a1-401a-4875-9cff-13ecb53e13fb.png。源位置与hash由契约保存，未使用CLI/API key或第三方素材站。

锁门/清场/过门仍由原run_controller驱动，未增加碰撞、等待或交互键。视觉解封0.38秒内升起栅门，暂停不推进；换房/重开立即重置，可在解封中按原规则过门，不残留回调。纹理缺失/画布不符，或栅门shader编译失败、缺少opening float uniform时，在创建任何表现节点前原子回退旧门。shader资源非null不足以启用新门，必须由引擎反射实际可赋值的uniform。--previous-gate只回退到前一门素材；--classic-environment回退整个旧环境/HUD/触控布局。

栅门使用[Polygon2D纹理](https://docs.godotengine.org/en/stable/classes/class_polygon2d.html)和[CanvasItem shader](https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/canvas_item_shader.html)；着色器只作用于栅门节点，未作用到房间或角色。
