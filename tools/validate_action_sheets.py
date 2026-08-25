"""复核动作表图片与打包报告，防止素材更新后悄悄破坏注册线。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


def validate(report_path: Path) -> int:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    sheet_path = report_path.with_name(report["sheet"])
    image = Image.open(sheet_path).convert("RGBA")
    columns = report["columns"]
    rows = report["rows"]
    cell_width = report["cellWidth"]
    cell_height = report["cellHeight"]
    baseline = report["baseline"]
    expected_size = (columns * cell_width, rows * cell_height)
    if image.size != expected_size:
        raise SystemExit(f"{sheet_path}: 尺寸 {image.size}，期望 {expected_size}")

    frames = report["frames"]
    if len(frames) != columns * rows:
        raise SystemExit(
            f"{report_path}: 帧报告 {len(frames)} 条，期望 {columns * rows} 条"
        )

    row_order = report["rowOrder"]
    for frame in frames:
        row = row_order.index(frame["action"])
        column = frame["frame"] - 1
        cell = image.crop(
            (
                column * cell_width,
                row * cell_height,
                (column + 1) * cell_width,
                (row + 1) * cell_height,
            )
        )
        box = cell.getchannel("A").getbbox()
        if box is None:
            raise SystemExit(f"{sheet_path}: {frame['action']} #{frame['frame']} 全透明")
        measured = [box[0], box[1], box[2] - 1, box[3] - 1]
        if measured != frame["bbox"]:
            raise SystemExit(
                f"{sheet_path}: {frame['action']} #{frame['frame']} bbox "
                f"{measured} 与报告 {frame['bbox']} 不一致"
            )
        # 基准线和安全边距是运行时切动作不跳、武器不被裁的两条硬门槛。
        if measured[3] != baseline:
            raise SystemExit(
                f"{sheet_path}: {frame['action']} #{frame['frame']} 脚底 "
                f"y={measured[3]}，期望 {baseline}"
            )
        if measured[0] == 0 or measured[1] == 0 or measured[2] == cell_width - 1 or measured[3] == cell_height - 1:
            raise SystemExit(
                f"{sheet_path}: {frame['action']} #{frame['frame']} 内容触边 {measured}"
            )

    print(
        f"[ok] {sheet_path.name}: {len(frames)} 帧，"
        f"{columns}×{rows} 格，baseline={baseline}，无触边"
    )
    return len(frames)


def main() -> None:
    parser = argparse.ArgumentParser(description="复核动作表尺寸、透明度、bbox 与脚底线")
    parser.add_argument("reports", nargs="+", type=Path, help="build_ai_action_sheet 生成的 JSON")
    args = parser.parse_args()
    total = sum(validate(path) for path in args.reports)
    print(f"[validate_action_sheets] 共 {total} 帧通过")


if __name__ == "__main__":
    main()
