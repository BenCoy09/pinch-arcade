import sys, json
from playwright.sync_api import sync_playwright
# usage: still.py out_prefix  -> contact stills at mid-points of every scene
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1280,'height':720})
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.goto('file://index.html'); pg.wait_for_timeout(500)
    L=pg.evaluate("(()=>{window.total();let a=0;return SC.map(s=>{const o={id:s.id,start:a,d:s.base};a+=s.base;return o})})()")
    for o in L:
        for k,f in enumerate((0.5,0.95)):
            pg.evaluate("t=>render(t)", o['start']+o['d']*f); pg.wait_for_timeout(80)
            pg.screenshot(path=f"/tmp/claude-0/-home-claude/03d762d0-2f33-518f-bc24-b9ee3d823830/scratchpad/video/st_{o['id']}_{k}.png")
    print(L, errs); b.close()
