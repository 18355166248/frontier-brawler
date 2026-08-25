"""把 AI 绿幕切图注册成 frontier-brawler 可直接读取的动作表。

输入既可以是六张原始 2×2 绿幕网格：

    <root>/<action>.png

也兼容已经切好、抠好的目录结构：

    <root>/<action>/cutouts/*.png

每个动作四帧，源图必须是同尺寸 RGBA。脚本对整套素材只使用一个缩放倍率，
然后用纯平移把脚底注册到同一条基准线，避免逐帧缩放造成切动作时角色跳动。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops


DEFAULT_ACTIONS = ("idle", "move", "slash", "slash2", "dash", "hit")


def clean_alpha(image: Image.Image, cutoff: int) -> Image.Image:
    """去掉绿幕抠图留下的极淡边缘，让像素包围盒验收不受噪点影响。"""
    rgba = image.convert("RGBA")
    red, green, blue, alpha = rgba.split()
    alpha = alpha.point(lambda value: 0 if value < cutoff else value)
    return Image.merge("RGBA", (red, green, blue, alpha))


def remove_small_components(image: Image.Image, maximum: int) -> Image.Image:
    """清掉色键背景形成的小孤岛；默认关闭，避免误删箭杆等独立细件。"""
    if maximum <= 0:
        return image

    rgba = image.copy()
    alpha = rgba.getchannel("A")
    pixels = alpha.load()
    seen: set[tuple[int, int]] = set()
    components: list[list[tuple[int, int]]] = []
    for y in range(alpha.height):
        for x in range(alpha.width):
            if pixels[x, y] == 0 or (x, y) in seen:
                continue
            stack = [(x, y)]
            seen.add((x, y))
            component: list[tuple[int, int]] = []
            while stack:
                current_x, current_y = stack.pop()
                component.append((current_x, current_y))
                for next_x, next_y in (
                    (current_x - 1, current_y),
                    (current_x + 1, current_y),
                    (current_x, current_y - 1),
                    (current_x, current_y + 1),
                ):
                    if not (0 <= next_x < alpha.width and 0 <= next_y < alpha.height):
                        continue
                    if pixels[next_x, next_y] == 0 or (next_x, next_y) in seen:
                        continue
                    seen.add((next_x, next_y))
                    stack.append((next_x, next_y))
            components.append(component)

    # 主体永远保留；阈值只针对其余孤岛。hero 的绿幕背景偶尔会留下肉眼
    # 不可见但色距很大的 12px 色块，不能让它重新参与 bbox 和脚底注册。
    largest = max(components, key=len, default=[])
    for component in components:
        if component is largest or len(component) > maximum:
            continue
        for x, y in component:
            pixels[x, y] = 0
    rgba.putalpha(alpha)
    return rgba


def detect_background(image: Image.Image) -> tuple[int, int, int]:
    """用四角均值估计绿幕色，兼容模型输出中很轻的背景色波动。"""
    rgb = image.convert("RGB")
    width, height = rgb.size
    samples = [
        rgb.getpixel((0, 0)),
        rgb.getpixel((width - 1, 0)),
        rgb.getpixel((0, height - 1)),
        rgb.getpixel((width - 1, height - 1)),
    ]
    return tuple(
        round(sum(pixel[channel] for pixel in samples) / len(samples))
        for channel in range(3)
    )


def chroma_cutout(
    image: Image.Image, background: tuple[int, int, int], tolerance: int
) -> Image.Image:
    """只用 Pillow 做确定性色距抠图，避免复现流程隐含依赖 numpy/rembg。"""
    rgb = image.convert("RGB")
    channels = rgb.split()
    distances = [
        ImageChops.difference(channel, Image.new("L", rgb.size, value))
        for channel, value in zip(channels, background)
    ]
    distance = ImageChops.lighter(
        ImageChops.lighter(distances[0], distances[1]), distances[2]
    )
    soft = max(tolerance + 1, round(tolerance * 1.8))
    alpha = distance.point(
        lambda value: (
            0
            if value <= tolerance
            else (
                255
                if value >= soft
                else round((value - tolerance) * 255 / (soft - tolerance))
            )
        )
    )
    rgba = rgb.convert("RGBA")
    rgba.putalpha(alpha)
    return rgba


def slice_chroma_grid(path: Path, tolerance: int) -> list[Image.Image]:
    grid = Image.open(path).convert("RGB")
    width, height = grid.size
    background = detect_background(grid)
    frames: list[Image.Image] = []
    for row in range(2):
        for column in range(2):
            left = round(column * width / 2)
            top = round(row * height / 2)
            right = round((column + 1) * width / 2)
            bottom = round((row + 1) * height / 2)
            frames.append(
                chroma_cutout(
                    grid.crop((left, top, right, bottom)), background, tolerance
                )
            )
    return frames


def load_frames(
    root: Path, actions: tuple[str, ...], chroma_tolerance: int, mirror: bool = False
) -> tuple[list[tuple[str, list[Image.Image]]], str]:
    """
    mirror 逐帧水平翻转，用来救「整套素材生成时朝向反了」这一种情况。

    必须在切完网格之后按帧翻，不能直接翻整张 2×2 网格——那样会连带把
    第 1↔2、3↔4 帧的位置也调换，动作时序就倒过来了。

    翻转本身对这套素材是安全的：渲染层本来就用 `ctx.scale(facing, 1)`
    给每个精灵做镜像，同一个角色朝左朝右两种形态在游戏里一直都会出现，
    所以镜像不会引入「打光方向和别人不一致」这类新问题；它只是把
    「哪个逻辑朝向对应哪张画面」这件事掰回规格要求的那一边。
    """
    rows: list[tuple[str, list[Image.Image]]] = []
    source_sizes: set[tuple[int, int]] = set()
    source_kind: str | None = None
    for action in actions:
        grid_path = root / f"{action}.png"
        if grid_path.exists():
            if source_kind not in (None, "chroma-grids"):
                raise SystemExit("不能混用原始网格和 cutouts 目录")
            source_kind = "chroma-grids"
            frames = slice_chroma_grid(grid_path, chroma_tolerance)
        else:
            if source_kind not in (None, "cutouts"):
                raise SystemExit("不能混用原始网格和 cutouts 目录")
            source_kind = "cutouts"
            paths = sorted((root / action / "cutouts").glob("*.png"))
            if len(paths) != 4:
                raise SystemExit(
                    f"{action}: 需要 <root>/{action}.png 或恰好 4 张 cutout"
                )
            frames = [Image.open(path).convert("RGBA") for path in paths]
        if mirror:
            frames = [
                frame.transpose(Image.Transpose.FLIP_LEFT_RIGHT) for frame in frames
            ]
        source_sizes.update(frame.size for frame in frames)
        rows.append((action, frames))
    if len(source_sizes) != 1:
        raise SystemExit(f"整套动作源图尺寸不一致: {sorted(source_sizes)}")
    return rows, source_kind or "unknown"


def build(
    root: Path,
    output: Path,
    actions: tuple[str, ...],
    cell: int,
    inner: int,
    baseline: int,
    alpha_cutoff: int,
    chroma_tolerance: int,
    remove_components_under: int,
    mirror: bool = False,
) -> None:
    if not 0 < inner <= cell:
        raise SystemExit("inner 必须大于 0 且不超过 cell")
    if not 0 <= baseline < cell:
        raise SystemExit("baseline 必须落在单格内部")

    rows, source_kind = load_frames(root, actions, chroma_tolerance, mirror)
    source_size = rows[0][1][0].size
    if source_size[0] != source_size[1]:
        raise SystemExit(f"当前打包器要求正方形源格，收到 {source_size}")

    sheet = Image.new("RGBA", (cell * 4, cell * len(actions)), (0, 0, 0, 0))
    report: list[dict[str, object]] = []
    x_offset = (cell - inner) // 2

    for row_index, (action, frames) in enumerate(rows):
        for frame_index, source in enumerate(frames):
            # 关键约束：所有动作、所有帧都从完整源格缩到同一个 inner 尺寸；
            # 绝不能按各自内容包围盒缩放，否则角色会在动作切换时忽大忽小。
            resized = source.resize((inner, inner), Image.Resampling.LANCZOS)
            resized = clean_alpha(resized, alpha_cutoff)
            resized = remove_small_components(resized, remove_components_under)
            source_box = resized.getchannel("A").getbbox()
            if source_box is None:
                raise SystemExit(f"{action} frame {frame_index + 1}: 抠图后全透明")

            # 只做 y 方向平移，把最低的可见像素落到统一脚底线；x 方向仍沿用
            # 生成网格的固定相机坐标，避免长剑改变包围盒后把身体错误居中。
            y_offset = baseline - (source_box[3] - 1)
            cell_image = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
            cell_image.paste(resized, (x_offset, y_offset), resized)
            final_box = cell_image.getchannel("A").getbbox()
            if final_box is None:
                raise SystemExit(f"{action} frame {frame_index + 1}: 注册后全透明")
            if (
                final_box[0] == 0
                or final_box[2] == cell
                or final_box[1] == 0
                or final_box[3] == cell
            ):
                raise SystemExit(
                    f"{action} frame {frame_index + 1}: 内容触边 {final_box}，"
                    "请减小 --inner 或调整 --baseline"
                )
            if final_box[3] - 1 != baseline:
                raise SystemExit(
                    f"{action} frame {frame_index + 1}: 脚底注册失败，"
                    f"期望 {baseline}，实际 {final_box[3] - 1}"
                )

            sheet.paste(cell_image, (frame_index * cell, row_index * cell), cell_image)
            report.append(
                {
                    "action": action,
                    "frame": frame_index + 1,
                    "bbox": [
                        final_box[0],
                        final_box[1],
                        final_box[2] - 1,
                        final_box[3] - 1,
                    ],
                    "height": final_box[3] - final_box[1],
                    "yOffset": y_offset,
                }
            )

    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)
    output.with_suffix(".json").write_text(
        json.dumps(
            {
                "sheet": output.name,
                "columns": 4,
                "rows": len(actions),
                "rowOrder": list(actions),
                "cellWidth": cell,
                "cellHeight": cell,
                "sourceCell": source_size[0],
                "innerCell": inner,
                "scale": inner / source_size[0],
                "baseline": baseline,
                "alphaCutoff": alpha_cutoff,
                "chromaTolerance": chroma_tolerance,
                "removeComponentsUnder": remove_components_under,
                "sourceKind": source_kind,
                # 记进报告，免得「这张表到底翻没翻」只能靠翻命令历史
                "mirrored": mirror,
                "frames": report,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(
        f"[build_ai_action_sheet] {len(actions)}x4 单格={cell} "
        f"inner={inner} baseline={baseline} -> {output}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="AI 动作切图 -> 同缩放、同脚底线动作表"
    )
    parser.add_argument(
        "root", type=Path, help="包含 <action>.png 绿幕网格或 <action>/cutouts 的目录"
    )
    parser.add_argument("-o", "--output", type=Path, required=True)
    parser.add_argument("--actions", nargs="+", default=list(DEFAULT_ACTIONS))
    parser.add_argument("--cell", type=int, default=96)
    parser.add_argument(
        "--inner", type=int, default=88, help="完整源格统一缩放后的边长"
    )
    parser.add_argument("--baseline", type=int, default=90, help="单格内统一脚底 y")
    parser.add_argument("--alpha-cutoff", type=int, default=128)
    parser.add_argument("--chroma-tolerance", type=int, default=45)
    parser.add_argument(
        "--remove-components-under",
        type=int,
        default=0,
        help="删除主体外不超过指定像素数的 4 邻接孤岛；默认关闭",
    )
    parser.add_argument(
        "--mirror",
        action="store_true",
        help="逐帧水平翻转。整套素材生成时朝向反了（规格要求一律面向屏幕右侧）时用",
    )
    args = parser.parse_args()
    build(
        args.root,
        args.output,
        tuple(args.actions),
        args.cell,
        args.inner,
        args.baseline,
        args.alpha_cutoff,
        args.chroma_tolerance,
        args.remove_components_under,
        args.mirror,
    )


if __name__ == "__main__":
    main()
