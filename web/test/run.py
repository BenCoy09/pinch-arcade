import asyncio, os, sys
from playwright.async_api import async_playwright
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'..'))
OUT=os.path.dirname(os.path.abspath(__file__))
MOCK = """
(() => {
 const C = window.Chain, R = window.Rules;
 const auth = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 255);
 let st = { authority: auth, pearls: 100, round: 0, drops: 0, wins: 0, paid: 0, won: 0, refills: 0, status: 0, pendingTs: 0, ring: [], inventory: [0,0,0,0,0] };
 C.loadWallet = () => {}; C.address = () => 'MOCKaddr1111111111111111111111111111111111';
 C.exportSecret = () => 'MOCKSECRET'; C.sleep = (ms) => new Promise(r => setTimeout(r, Math.min(ms, 30)));
 C.setup = async (cb) => { cb('wallet'); await C.sleep(10); cb('fund', {note:'x'}); cb('funded',{ms:100}); cb('created',{ms:100}); cb('delegated',{ms:100}); cb('login',{ms:100}); return st; };
 C.fetchEr = async () => st;
 C.receipts = (s) => s.ring.slice().reverse();
 let n = 0;
 C.drop = async (machine, xpm, cb) => {
   cb('sealed', { sig: '5'.repeat(40) }); await C.sleep(10); cb('rolling'); cb('revealing');
   const rnd = new Uint8Array(32).map(() => Math.floor(Math.random()*256));
   const r = R.recompute(auth, st.round, machine, xpm, rnd);
   const m = R.MACHINES[machine];
   const rc = { round: st.round, machine, xPm: xpm, slot: r.slot ?? 0, kind: r.kind ?? 0, centering: r.centering ?? 0, chance: r.chance ?? 0,
     outcome: r.outcome === 'miss' ? 1 : (r.roll <= r.chance ? 3 : 2), roll: r.roll ?? 0, randomness: rnd };
   if (window.__forceOutcome && rc.outcome !== 1) rc.outcome = window.__forceOutcome;
   st = Object.assign({}, st, { pearls: st.pearls - m.ticket + (rc.outcome === 3 ? R.VALUE[rc.kind] : 0), round: st.round + 1, drops: st.drops + 1, paid: st.paid + m.ticket });
   if (rc.outcome === 3) { st.wins++; st.won += R.VALUE[rc.kind]; st.inventory = st.inventory.slice(); st.inventory[rc.kind]++; }
   st.ring = st.ring.concat([rc]);
   return { state: st, signature: '5'.repeat(40), ms: 1000 };
 };
 C.racers = async () => [{player:'7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',golden:2,won:260,paid:90,drops:14,wins:6,inventory:[0,0,0,0,2]},{player:'Hq4mPz9RWkSd5ncVfeLxE6Jt8XaB3yUoNcDgTi2sQw1A',golden:1,won:140,paid:60,drops:9,wins:3,inventory:[0,0,0,1,1]},{player:C.address(),golden:0,won:0,paid:0,drops:1,wins:0,inventory:[0,0,0,0,0]}];
 C.readBaseState = async () => null; C.saveToSolana = async () => ({});
 C.timings.total = 3000; C.timings.drop_claw = 1200; C.timings.reveal = 900;
 window.__st = () => st;
})();
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':int(os.environ.get('VW',390)),'height':int(os.environ.get('VH',844))})
        errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
        async def route(r):
            u=r.request.url
            if u.startswith('file://'): await r.continue_()
            else: await r.fulfill(status=200, body='', content_type='application/javascript')
        await pg.route('**/*', route)
        await pg.goto('file://'+ROOT+'/index.html')
        await pg.evaluate(MOCK)
        await pg.screenshot(path=OUT+'/'+os.environ.get('PFX','')+'1start.png')
        await pg.click('#startBtn')
        await pg.wait_for_selector('#v-street:not([hidden])', timeout=8000)
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=OUT+'/'+os.environ.get('PFX','')+'2street.png')
        await pg.evaluate('window.__pinch.enterMachine(0)')
        await pg.wait_for_selector('#v-cab:not([hidden])')
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=OUT+'/'+os.environ.get('PFX','')+'3cab.png')
        # aim at slot 3 center: pm=90+117*3=441 -> px
        await pg.evaluate("window.__pinch.G.clawX = 22 + 441*0.32")
        await pg.click('#bD')
        await pg.wait_for_selector('#sheet:not([hidden])', timeout=20000)
        await pg.wait_for_timeout(2200)
        await pg.screenshot(path=OUT+'/'+os.environ.get('PFX','')+'4receipt.png')
        txt = await pg.inner_text('#sheetBody')
        print('RECEIPT:', txt.replace('\n',' | ')[:500])
        print('verified' , 'VERIFIED' in txt, 'MISMATCH' in txt)
        # several more drops across machines, check every receipt verifies
        bad=0
        for mi in (0,1,2,0,1,2):
            await pg.evaluate("document.getElementById('sheet').hidden=true; window.__pinch.G.state='idle'; window.__pinch.home()")
            await pg.evaluate("window.__pinch.enterMachine(%d)"%mi)
            await pg.evaluate("window.__pinch.G.clawX = 22 + (90+117*%d)*0.32"%((mi*3)%8))
            await pg.click('#bD')
            try:
                await pg.wait_for_selector('#sheet:not([hidden])', timeout=20000)
            except Exception as e:
                print('timeout machine', mi, await pg.evaluate('window.__pinch.G.state')); bad+=1; continue
            t = await pg.inner_text('#sheetBody')
            if 'MISMATCH' in t or 'VERIFIED' not in t: bad+=1; print('bad receipt', mi, t[:200])
        print('bad receipts:', bad)
        await pg.evaluate("document.getElementById('sheet').hidden=true; window.__pinch.G.state='idle'; window.__pinch.home()")
        await pg.wait_for_timeout(300)
        await pg.click('#stRace'); await pg.wait_for_timeout(600)
        print('RACE:', (await pg.inner_text('#sheetBody')).replace('\n',' | ')[:300])
        await pg.screenshot(path=OUT+'/'+os.environ.get('PFX','')+'6race.png')
        await pg.evaluate("document.getElementById('sheet').hidden=true")
        await pg.click('#stMiss'); await pg.wait_for_timeout(300)
        print('MISS:', (await pg.inner_text('#sheetBody')).replace('\n',' | ')[:400])
        await pg.evaluate("document.getElementById('sheet').hidden=true")
        # walk to the Reef door by tapping, then press Enter prompt
        await pg.evaluate("document.querySelector('#stcv').dispatchEvent(new PointerEvent('pointerdown',{clientX:10,clientY:10,bubbles:true}))")
        await pg.keyboard.down('ArrowRight'); await pg.wait_for_timeout(2300); await pg.keyboard.up('ArrowRight')
        print('ACT:', await pg.inner_text('#stAct'))
        await pg.screenshot(path=OUT+'/'+os.environ.get('PFX','')+'7walk.png')
        await pg.click('#stAct'); await pg.wait_for_timeout(300)
        print('IN CAB:', await pg.evaluate('!document.getElementById("v-cab").hidden'))
        await pg.screenshot(path=OUT+'/'+os.environ.get('PFX','')+'5after.png')
        print('ERRORS', errs)
        await b.close()
asyncio.run(main())
