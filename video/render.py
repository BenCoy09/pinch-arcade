# Renders the demo: scenes (HTML engine) -> frames -> ffmpeg; optional ElevenLabs audio and live clips.
# usage: python3 render.py [--fps 30] [--out demo.mp4] [--audio audio/]   (audio/<scene>.mp3 sets each scene's length)
import sys, os, json, subprocess, argparse
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser(); ap.add_argument('--fps', type=int, default=30); ap.add_argument('--out', default='demo.mp4'); ap.add_argument('--audio', default='audio'); ap.add_argument('--stills', action='store_true')
a = ap.parse_args()
IDS = ['hook', 'real', 'meet', 'how', 'math', 'limits', 'outro']
durs = {}; aud = []
for i in IDS:
    f = os.path.join(HERE, a.audio, i + '.mp3')
    if os.path.exists(f):
        d = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).decode().strip())
        durs[i] = round(d + 0.8, 2); aud.append((i, f))
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.add_init_script('window.DURS=' + json.dumps(durs))
    pg.goto('file://' + HERE + '/index.html'); pg.wait_for_timeout(600)
    total = pg.evaluate('window.total()'); n = int(total * a.fps)
    print('total', total, 'frames', n, flush=True)
    silent = os.path.join(HERE, 'silent.mp4')
    ff = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', str(a.fps), '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', silent], stdin=subprocess.PIPE)
    for k in range(n):
        pg.evaluate('t=>render(t)', k / a.fps)
        ff.stdin.write(pg.screenshot(type='jpeg', quality=92))
        if k % 150 == 0: print(k, flush=True)
    ff.stdin.close(); ff.wait(); b.close()
out = os.path.join(HERE, a.out)
if aud:
    # build the audio track: each narration starts 0.3s into its scene
    cmd = ['ffmpeg', '-loglevel', 'error', '-y', '-i', silent]; filt = []; labels = []; t = 0.0
    base = {'hook': 10, 'real': 16, 'meet': 10, 'how': 24, 'math': 20, 'limits': 14, 'outro': 12}
    k = 0
    for i in IDS:
        d = durs.get(i, base[i])
        f = os.path.join(HERE, a.audio, i + '.mp3')
        if os.path.exists(f):
            cmd += ['-i', f]; k += 1
            filt.append('[%d:a]adelay=%d|%d[a%d]' % (k, int((t + 0.3) * 1000), int((t + 0.3) * 1000), k)); labels.append('[a%d]' % k)
        t += d
    filt.append(''.join(labels) + 'amix=inputs=%d:normalize=0[aout]' % len(labels))
    cmd += ['-filter_complex', ';'.join(filt), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', out]
    subprocess.check_call(cmd)
else:
    os.replace(silent, out)
print('wrote', out)
