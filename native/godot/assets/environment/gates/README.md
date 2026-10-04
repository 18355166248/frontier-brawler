# 月下山门运行素材

来源：用户任务中由父任务使用OpenAI内置image_gen制作，按当前游戏截图统一光照和材料；本机已物化Library `libfile_cc4996e36fec81918ba0cf7b2ce7e301` 的 `wudu-gate-assets-v1.zip`，9,684,016字节，SHA256 `b2674931e7092531a2cc9ea872a1faadb442f1ce763c2cc734eaa82c79209377`。原图、Prompt、合成预览保留在来源Library包与本机忽略目录，不重复放入生产资源。

仅导入4张运行PNG，字节未修改；精确尺寸/alpha/文件hash见 [asset-contract.json](asset-contract.json)。统一640×1024 RGBA，pivot(320,960)，世界scale0.2。绘制背到前：closed-panels或open-mist → frame → boss-accent。雾运行alpha0.28，轻微呼吸，不用加法混合。Boss红帘用于进入Boss的门；Boss房无东出口，不画出口门。

主场景在mistward_room.gd使用同一缩放Rect，一次性将pivot/尺寸乘0.2。无新增碰撞，通行仍由run_controller.gd既有清场与x/depth谓词决定。资源丢失/画布不符时沿用旧门绘制；`--classic-environment`回退整套旧环境/HUD布局。

缺少实体开门动作序列：本轮直接切封闭/开启图层，不加入等待或修改战斗时序。帧内极淡alpha1–3继承自生图；外边缘透明，门洞clearcore最大alpha3，锁门板core alpha251–254。本机Pillow验证已通过，最终质量以游戏实际渲染为准。
