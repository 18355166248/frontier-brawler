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
CELL_INSET = 12


def alpha_from_magenta(red: int, green: int, blue: int) -> int:
    """洋红优势越强越透明；保留棕木、红布和暗色抗锯齿边缘。"""
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


def build(source_path: Path, output_path: Path) -> None:
    source = Image.open(source_path).convert("RGB")
    if source.width % 2 or source.height % 2:
        raise SystemExit("建筑源网格必须能严格二等分")

    rgba = Image.new("RGBA", source.size)
    rgba.putdata([keyed_pixel(red, green, blue) for red, green, blue in source.getdata()])

    cell_width = source.width // 2
    cell_height = source.height // 2
    # 每栋、每态统一缩到同一安全框，避免只修触边格后切换状态时建筑尺寸跳动。
    normalized = Image.new("RGBA", source.size)
    target_size = (cell_width - CELL_INSET * 2, cell_height - CELL_INSET * 2)
    for row in range(2):
        for column in range(2):
            box = (
                column * cell_width,
                row * cell_height,
                (column + 1) * cell_width,
                (row + 1) * cell_height,
            )
            cell = rgba.crop(box).resize(target_size, Image.Resampling.LANCZOS)
            normalized.alpha_composite(
                cell,
                (column * cell_width + CELL_INSET, row * cell_height + CELL_INSET),
            )
    rgba = normalized
    alpha = rgba.getchannel("A")

    for row in range(2):
        for column in range(2):
            box = (
                column * cell_width,
                row * cell_height,
                (column + 1) * cell_width,
                (row + 1) * cell_height,
            )
            bounds = alpha.crop(box).getbbox()
            if bounds is None:
                raise SystemExit(f"第 {row * 2 + column + 1} 格没有可见内容")
            left, top, right, bottom = bounds
            if left < 8 or top < 8 or right > cell_width - 8 or bottom > cell_height - 8:
                raise SystemExit(f"第 {row * 2 + column + 1} 格可见内容触格: {bounds}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    rgba.save(output_path, optimize=True)
    print(f"[build_building_atlas] PASS: {source.width}x{source.height} RGBA -> {output_path}")


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
