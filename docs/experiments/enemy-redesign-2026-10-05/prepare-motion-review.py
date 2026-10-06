"""从已检查的连通原画注册关键姿态，交给现有 asset_bundle 打草稿。"""
from pathlib import Path
import hashlib
import json
import argparse
import numpy as np
from PIL import Image
from scipy.ndimage import label, binary_dilation

BASE = Path(__file__).resolve().parent
CELL = 640
PIVOT = (308, 560)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default='motion-layout.json')
    parser.add_argument('--out', default='motion-registered-v1')
    args = parser.parse_args()
    config = json.loads((BASE / args.config).read_text())
    output = BASE / args.out
    output.mkdir(exist_ok=False)
    atlas = Image.new('RGBA', (CELL * 4, CELL * len(config['actions'])))
    records, tags, registrations = [], [], []
    for row, action in enumerate(config['actions']):
        path = BASE / action['image']
        raw = np.array(Image.open(path).convert('RGBA'))
        labels, _ = label(raw[:, :, 3] > 64)
        sizes = np.bincount(labels.ravel())
        ids = list(np.argsort(sizes[1:])[-4:] + 1)
        # 依据真实连通轮廓排序，刀尖跨越格子时仍保留整个武器，不能直接四等分裁切。
        ids.sort(key=lambda i: (np.where(labels == i)[0].mean() > raw.shape[0] / 2,
                               np.where(labels == i)[1].mean()))
        start = len(records)
        for index, region in enumerate(ids):
            mask = labels == region
            ys, xs = np.where(mask)
            if sizes[region] < 10000 or mask[0].any() or mask[-1].any() or mask[:, 0].any() or mask[:, -1].any():
                raise ValueError(f"{action['name']}:{index}: 原画缺失或触边裁切")
            # 只清理独立透明噪点，软轮廓保留；比例按整张生成批次指定，不按每帧 bbox 调整。
            keep = binary_dilation(mask, iterations=2) & (raw[:, :, 3] > 8)
            pixels = raw.copy()
            pixels[~keep] = 0
            x1, y1, x2, y2 = action['foot_rois'][index]
            foot_y = np.where(mask[y1:y2, x1:x2])[0]
            if not len(foot_y):
                raise ValueError('人工标记的落脚区域为空')
            ground_y = int(foot_y.max() + y1)
            scale = action['scale']
            source = Image.fromarray(pixels)
            scaled = source.resize((round(source.width * scale), round(source.height * scale)), Image.Resampling.LANCZOS)
            offset = (round(PIVOT[0] - action['anchors_x'][index] * scale), round(PIVOT[1] - ground_y * scale))
            frame = Image.new('RGBA', (CELL, CELL))
            frame.alpha_composite(scaled, offset)
            alpha = np.array(frame)[:, :, 3]
            box = frame.getchannel('A').point(lambda x: 255 if x > 8 else 0).getbbox()
            if not box or min(box[:2]) < 8 or max(box[2:]) > CELL - 8 or np.count_nonzero(alpha > 8) != np.count_nonzero(np.array(scaled)[:, :, 3] > 8):
                raise ValueError('注册后轮廓越界，禁止发布截断素材')
            frame.save(output / f"{action['name']}-{index}.png")
            atlas.alpha_composite(frame, (index * CELL, row * CELL))
            records.append({'filename': str(len(records)), 'frame': {'x': index * CELL, 'y': row * CELL, 'w': CELL, 'h': CELL},
                            'trimmed': False, 'rotated': False, 'duration': action['durations_ms'][index]})
            registrations.append({'action': action['name'], 'frame': index, 'source': action['image'],
                                  'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'scale': scale,
                                  'source_bbox': [int(xs.min()), int(ys.min()), int(xs.max()+1), int(ys.max()+1)],
                                  'foot_roi': action['foot_rois'][index], 'ground_y': ground_y,
                                  'offset': list(offset), 'result_bbox': list(box)})
        tags.append({'name': action['name'], 'from': start, 'to': len(records)-1, 'direction': 'forward'})
    atlas.save(output / 'source.png')
    (output / 'source.json').write_text(json.dumps({'frames': records, 'meta': {'image': 'source.png', 'frameTags': tags}}, indent=2))
    (output / 'registration.json').write_text(json.dumps(registrations, indent=2))
    recipe = {'version': 1, 'kind': 'motion', 'title': '怪物动作关键姿态 · 草稿', 'cell': [CELL, CELL],
              'anchor': [PIVOT[0]/CELL, PIVOT[1]/CELL], 'resample': 'lanczos', 'background': 'keep',
              'source': {'provider': 'codex-builtin-imagegen', 'calls': config['generation_calls'],
                         'note': '三身份已认可；近战 move 待修；攻击关键姿态待用户验收，缺中间帧和受击死亡；未接入游戏'},
              'states': [{'name': a['name'], 'loop': a['loop']} for a in config['actions']]}
    (output / 'recipe.json').write_text(json.dumps(recipe, ensure_ascii=False, indent=2))
    print(f'REGISTERED {len(records)} inspected poses; no runtime integration')

if __name__ == '__main__':
    main()
