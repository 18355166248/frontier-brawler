"""把已注册姿态映射为 Godot 候选包；来源、复用和验收状态随包保存。"""
from pathlib import Path
import hashlib
import json
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/experiments/enemy-redesign-2026-10-05/motion-registered-v2'
OUTPUT = ROOT / 'native/godot/assets/enemy-roster-v2'

def main():
    registrations = json.loads((SOURCE / 'registration.json').read_text())
    for kind, identity, attack in [('grunt', 'redmane', 'slash'), ('archer', 'mossfeather', 'shoot'), ('mage', 'whitemask', 'cast')]:
        directory = OUTPUT / kind
        directory.mkdir(parents=True, exist_ok=True)
        bindings = {
            'idle': ([f'{identity}-responses-0'], [800], True),
            'move': ([f'{identity}-move-{i}' for i in range(4)], [180]*4, True),
            'hit': ([f'{identity}-responses-1'], [333], False),
            'death': ([f'{identity}-responses-2', f'{identity}-responses-3'], [180, 220], False),
        }
        if kind == 'grunt':
            bindings[attack] = ([f'{identity}-slash-{i}' for i in range(4)], [133, 84, 83, 100], False)
        elif kind == 'archer':
            bindings['archerAim'] = ([f'{identity}-shoot-{i}' for i in range(2)], [200, 500], False)
            bindings['archerShoot'] = ([f'{identity}-shoot-{i}' for i in range(2, 4)], [80, 420], False)
        else:
            bindings['lanternCast'] = ([f'{identity}-cast-{i}' for i in range(4)], [250, 650, 150, 600], False)
        animations = {}
        for name, (sources, durations, loop) in bindings.items():
            atlas = Image.new('RGBA', (640 * len(sources), 640))
            frames = []
            for index, (source, duration) in enumerate(zip(sources, durations)):
                path = SOURCE / (source + '.png')
                atlas.alpha_composite(Image.open(path).convert('RGBA'), (index * 640, 0))
                frames.append({'rect_px': [index*640, 0, 640, 640], 'duration_ms': duration, 'source': source,
                               'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
            atlas.save(directory / (name + '.png'))
            animations[name] = {'sheet': name+'.png', 'frames': frames, 'duration_ms': sum(durations),
                                'loop': loop, 'frame_count': len(frames)}
            if name == 'slash':
                animations[name]['impact_ms'] = [133, 217]
        manifest = {'version': 1, 'kind': kind, 'canvas_px': [640,640], 'pivot_px': [308,560],
                    'art_scale': .30, 'stride_world_px': 58, 'animations': animations,
                    'status': 'integrated-candidate', 'identity_approval': 'user-approved',
                    'attack_approval': 'user: 合适 继续', 'new_motion_approval': 'pending',
                    'idle_note': 'single generated guard pose held; not a generated breathing animation'}
        (directory / 'animation.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
        (directory / 'registration.json').write_text(json.dumps([r for r in registrations if r['action'].startswith(identity)], indent=2)+'\n')
        shutil.copyfile(ROOT/'docs/experiments/enemy-redesign-2026-10-05/CONTINUATION-RESULTS.json', directory/'generation.json')
        print(kind, len(animations), 'candidate actions')

if __name__ == '__main__':
    main()
