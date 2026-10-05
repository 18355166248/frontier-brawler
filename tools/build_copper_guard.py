"""Extract inspected, connected full-body paintings; never scale each pose by its bbox.

Run with ai-asset-pipeline/.venv-cutout/bin/python (Pillow, numpy, scipy).
Inputs are explicit source layouts and actual generation records. No AI calls,
joint reconstruction, frame interpolation, or combat data edits happen here.
"""
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import label, binary_dilation

CELL = 640
PIVOT = (308, 560)

def extract(base, entry, layout, report):
    path = base / entry['path']
    image = Image.open(path).convert('RGBA')
    raw = np.array(image)
    labels, _ = label(raw[:, :, 3] > 64)
    sizes = np.bincount(labels.ravel())
    count = layout.get('count', 4)
    largest = list(np.argsort(sizes[1:])[-count:] + 1)
    if any(sizes[x] < 10000 for x in largest):
        raise ValueError(f"{entry['id']}: missing full-body connected component")
    # Sort real silhouettes, not guessed equal-grid crop rectangles. A long blade
    # may cross the nominal cell boundary; keep its complete connected silhouette.
    centers = {}
    for region in largest:
        ys, xs = np.where(labels == region)
        centers[region] = (float(xs.mean()), float(ys.mean()))
    largest.sort(key=lambda x: (centers[x][1] > image.height / 2, centers[x][0]))
    result = {}
    for index, region in enumerate(largest):
        mask = labels == region
        ys, xs = np.where(mask)
        boundary = bool(mask[0].any() or mask[-1].any() or mask[:, 0].any() or mask[:, -1].any())
        key = f"{entry['id']}:{index}"
        if index in layout.get('reject_frames', []):
            report.append({'key': key, 'selected': False, 'reason': layout['reject_reason'], 'source_edge': boundary})
            continue
        if boundary:
            raise ValueError(f'{key}: source character/weapon is cut at the image edge')
        # Preserve soft outline near this actual character; discard unrelated
        # near-transparent background specks and other grid characters.
        keep = binary_dilation(mask, iterations=2) & (raw[:, :, 3] > 8)
        isolated = raw.copy()
        isolated[~keep] = 0
        source = Image.fromarray(isolated)
        scale = .36 if count == 1 else .72  # Same camera scale for every source grid.
        anchor_x = layout['anchors_x'][index]
        roi = layout['foot_rois'][index]
        ground = (raw[roi[1]:roi[3], roi[0]:roi[2], 3] > 64) & mask[roi[1]:roi[3], roi[0]:roi[2]]
        occupied_y = np.where(ground)[0]
        if not len(occupied_y):
            raise ValueError(f'{key}: empty explicitly inspected foot/ground region')
        ground_y = int(occupied_y.max() + roi[1])
        scaled = source.resize((round(source.width * scale), round(source.height * scale)), Image.Resampling.LANCZOS)
        offset = (round(PIVOT[0] - anchor_x * scale), round(PIVOT[1] - ground_y * scale))
        canvas = Image.new('RGBA', (CELL, CELL))
        canvas.alpha_composite(scaled, offset)
        # Resampling halos cannot be used to hide clipped body/weapon pixels.
        box = canvas.getchannel('A').point(lambda x: 255 if x > 8 else 0).getbbox()
        if not box or box[0] < 8 or box[1] < 8 or box[2] > CELL - 8 or box[3] > CELL - 8:
            raise ValueError(f'{key}: no safe margin after registration: {box}')
        expected = int(np.count_nonzero(np.array(scaled)[:, :, 3] > 8))
        if np.count_nonzero(np.array(canvas)[:, :, 3] > 8) != expected:
            raise ValueError(f'{key}: registration clipped source pixels')
        result[key] = canvas
        report.append({'key': key, 'selected': True, 'source_component': int(region),
                       'source_bbox': [int(xs.min()), int(ys.min()), int(xs.max()+1), int(ys.max()+1)],
                       'source_size': list(image.size), 'foot_roi': roi, 'anchor_x': anchor_x,
                       'ground_y': ground_y, 'scale': scale, 'offset': list(offset), 'bbox': list(box)})
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('recipe', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--preview', type=Path, required=True)
    args = parser.parse_args()
    recipe = json.loads(args.recipe.read_text())
    base = Path(__file__).resolve().parents[1]
    args.out.mkdir(parents=True, exist_ok=True)
    args.preview.mkdir(parents=True, exist_ok=True)
    frames, report = {}, []
    for entry in recipe['generations']:
        if entry['id'] not in recipe['layouts']:
            continue
        frames.update(extract(base, entry, recipe['layouts'][entry['id']], report))
    animations = {}
    contacts = []
    for name, action in recipe['actions'].items():
        ids, durations = action['sources'], action['durations_ms']
        if len(ids) != len(durations) or not all(x > 0 for x in durations):
            raise ValueError(f'{name}: invalid duration contract')
        sheet = Image.new('RGBA', (CELL * len(ids), CELL))
        records = []
        gif = []
        for i, source in enumerate(ids):
            frame = frames[source]
            sheet.alpha_composite(frame, (i * CELL, 0))
            records.append({'rect_px': [i * CELL, 0, CELL, CELL], 'duration_ms': durations[i], 'source': source})
            tile = Image.new('RGB', (240, 270), '#cfd3d2')
            reduced = frame.resize((224, 224), Image.Resampling.LANCZOS)
            tile.paste(reduced, (8, 34), reduced)
            ImageDraw.Draw(tile).text((8, 8), f'{name} {i+1} / {durations[i]}ms', fill='#142b30')
            contacts.append(tile)
            clean = Image.new('RGB', (640, 640), '#d4d6d5')
            clean.paste(frame, (0, 0), frame)
            gif.append(clean.resize((384, 384), Image.Resampling.LANCZOS))
        sheet.save(args.out / f'{name}.png')
        anim = {'sheet': f'{name}.png', 'frames': records, 'duration_ms': sum(durations),
                'loop': name in ['idle', 'move'], 'frame_count': len(ids)}
        if 'impact_ms' in action:
            anim['impact_ms'] = action['impact_ms']
        animations[name] = anim
        gif[0].save(args.preview / f'{name}.gif', save_all=True, append_images=gif[1:],
                    duration=durations, loop=0 if anim['loop'] else 1, disposal=2)
    manifest = {'version': 1, 'canvas_px': [640, 640], 'pivot_px': list(PIVOT),
                'art_scale': .38, 'stride_world_px': 60, 'animations': animations}
    (args.out / 'animation.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    (args.out / 'registration.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    source_log = dict(recipe)
    for record in source_log['generations']:
        record['sha256'] = hashlib.sha256((base / record['path']).read_bytes()).hexdigest()
    source_log['review'] = {'status': 'integrated-candidate', 'user_direction': 'Boss再酷炫一点，然后可以植入到游戏中',
                            'pixel_motion_approval': 'pending user visual review',
                            'video_generation_calls': 0, 'source': 'codex-builtin-imagegen'}
    (args.out / 'provenance.json').write_text(json.dumps(source_log, ensure_ascii=False, indent=2)+'\n')
    board = Image.new('RGB', (6*240, ((len(contacts)+5)//6)*270), '#cfd3d2')
    for i, tile in enumerate(contacts):
        board.paste(tile, ((i%6)*240, (i//6)*270))
    board.save(args.preview / 'contact.png')
    used = {x for a in recipe['actions'].values() for x in a['sources']}
    print(f'COPPER_GUARD_PACKED animations={len(animations)} positions={len(contacts)} unique_sources={len(used)}')

if __name__ == '__main__':
    main()
