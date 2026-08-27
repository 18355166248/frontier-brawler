#!/usr/bin/env python3

"""把 AI 生成的洋红底 2×2 建筑网格转成可直接加载的透明 PNG。"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

BUILDINGS = {
    "training-ground": "training-ground",
    "forge": "forge",
    "alchemy-lab": "alchemy-lab",
    "resource-field": "resource-field",
    "archive": "archive",
}
OUTPUT_CELL_SIZE = 192
CELL_INSET = 12
MIN_VISIBLE_MARGIN = 8
BASELINE = OUTPUT_CELL_SIZE - CELL_INSET
MIN_COMPONENT_AREA = 512
RUNTIME_STATES = ((0, 0), (1, 0), (0, 1))


def alpha_from_magenta(red: int, green: int, blue: int) -> int:
    """洋红优势越强越透明；饱和紫/品红会误入软过渡带，禁止用于建筑配色。"""
    key_strength = min(red, blue) - green
    if key_strength >= 170:
        return 0
    if key_strength <= 90:
        return 255
    return round((170 - key_strength) / 80 * 255)


def keyed_pixel(red: int, green: int, blue: int) -> tuple[int, int, int, int]:
    alpha = alpha_from_magenta(red, green, blue)
    if alpha == 0:
        # 透明区清空 RGB，既避免预览器误显色键，也显著减小最终 PNG。
        return 0, 0, 0, 0
    if alpha == 255:
        return red, green, blue, 255
    ratio = alpha / 255
    key = (248, 4, 245)
    foreground = tuple(
        max(0, min(255, round((channel - (1 - ratio) * key_channel) / ratio)))
        for channel, key_channel in zip((red, green, blue), key)
    )
    return foreground[0], foreground[1], foreground[2], alpha


def remove_small_components(cell: Image.Image) -> int:
    """清掉 AI 偶发的独立碎点；主体地台会把合法装饰连成同一大组件。"""
    alpha = cell.getchannel("A")
    width, height = alpha.size
    pixels = alpha.load()
    visited = bytearray(width * height)
    rgba = cell.load()
    removed = 0

    for start_y in range(height):
        for start_x in range(width):
            start = start_y * width + start_x
            if visited[start] or pixels[start_x, start_y] == 0:
                continue
            stack = [(start_x, start_y)]
            visited[start] = 1
            component: list[tuple[int, int]] = []
            while stack:
                x, y = stack.pop()
                component.append((x, y))
                for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if next_x < 0 or next_y < 0 or next_x >= width or next_y >= height:
                        continue
                    index = next_y * width + next_x
                    if visited[index] or pixels[next_x, next_y] == 0:
                        continue
                    visited[index] = 1
                    stack.append((next_x, next_y))
            if len(component) >= MIN_COMPONENT_AREA:
                continue
            removed += len(component)
            for x, y in component:
                rgba[x, y] = (0, 0, 0, 0)
    return removed


def build(source_path: Path, output_path: Path) -> None:
    source = Image.open(source_path).convert("RGB")
    if source.width % 2 or source.height % 2:
        raise SystemExit("建筑源网格必须能严格二等分")

    rgba = Image.new("RGBA", source.size)
    rgba.putdata([keyed_pixel(red, green, blue) for red, green, blue in source.getdata()])

    source_cell_width = source.width // 2
    source_cell_height = source.height // 2
    if CELL_INSET < MIN_VISIBLE_MARGIN:
        raise SystemExit("CELL_INSET 小于最低安全边距")

    # 源图保留四态和图标；运行时只打包实际绘制的前三态，避免白占 25% 下载体积。
    output = Image.new("RGBA", (OUTPUT_CELL_SIZE * len(RUNTIME_STATES), OUTPUT_CELL_SIZE))
    target_size = (OUTPUT_CELL_SIZE - CELL_INSET * 2, OUTPUT_CELL_SIZE - CELL_INSET * 2)
    source_cells: list[Image.Image] = []
    removed_pixels = 0
    for row in range(2):
        for column in range(2):
            box = (
                column * source_cell_width,
                row * source_cell_height,
                (column + 1) * source_cell_width,
                (row + 1) * source_cell_height,
            )
            cell = rgba.crop(box)
            removed_pixels += remove_small_components(cell)
            if cell.getchannel("A").getbbox() is None:
                raise SystemExit(f"源图第 {row * 2 + column + 1} 格没有可见内容")
            source_cells.append(cell)

    for output_column, (source_column, source_row) in enumerate(RUNTIME_STATES):
        source_index = source_row * 2 + source_column
        cell = source_cells[source_index].resize(target_size, Image.Resampling.LANCZOS)
        bounds = cell.getchannel("A").getbbox()
        if bounds is None:
            raise SystemExit(f"运行态第 {output_column + 1} 格没有可见内容")
        # 三态共用同一缩放倍率，并把最低可见像素注册到同一条底线，切状态不再上跳。
        x = output_column * OUTPUT_CELL_SIZE + CELL_INSET
        y = BASELINE - bounds[3]
        output.alpha_composite(cell, (x, y))

        final_bounds = output.getchannel("A").crop((
            output_column * OUTPUT_CELL_SIZE,
            0,
            (output_column + 1) * OUTPUT_CELL_SIZE,
            OUTPUT_CELL_SIZE,
        )).getbbox()
        if final_bounds is None:
            raise SystemExit(f"运行态第 {output_column + 1} 格没有可见内容")
        left, top, right, bottom = final_bounds
        if (
            left < MIN_VISIBLE_MARGIN
            or top < MIN_VISIBLE_MARGIN
            or right > OUTPUT_CELL_SIZE - MIN_VISIBLE_MARGIN
            or bottom > OUTPUT_CELL_SIZE - MIN_VISIBLE_MARGIN
        ):
            raise SystemExit(f"运行态第 {output_column + 1} 格安全边距不足: {final_bounds}")
        if bottom != BASELINE:
            raise SystemExit(f"运行态第 {output_column + 1} 格底线未注册: {bottom} != {BASELINE}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path, optimize=True)
    print(
        f"[build_building_atlas] PASS: {output.width}x{output.height} RGBA, "
        f"baseline={BASELINE}, removed={removed_pixels}px -> {output_path}"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", nargs="?", type=Path)
    parser.add_argument("-o", "--output", type=Path)
    parser.add_argument("--all", action="store_true", help="重建仓库内全部建筑图集")
    args = parser.parse_args()

    if args.all:
        if args.source or args.output:
            parser.error("--all 不能和单文件参数一起使用")
        source_dir = Path("docs/experiments/base-buildings-2026-08-27")
        output_dir = Path("public/art/buildings")
        for source_name, output_name in BUILDINGS.items():
            build(source_dir / f"{source_name}-grid.png", output_dir / f"{output_name}-v1.png")
        return
    if not args.source or not args.output:
        parser.error("单文件模式需要 source 和 --output")
    build(args.source, args.output)


if __name__ == "__main__":
    main()
