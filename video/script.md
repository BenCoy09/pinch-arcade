# Pinch's Arcade demo: narration + recording guide

## 1. Voice (ElevenLabs)
Generate ONE audio file per block below. Save them with EXACTLY these names (mp3) and send them to me.
Voice tip: calm, warm, confident, not salesy. Stability about 50-60%. Leave the pauses in.

hook.mp3
Uncle Crimp's sign said: win every time. His claws never held. And the golden pearl he promised? It was never in the machine.

real.mp3
This is what we face in real life. You can't see the odds. The roll happens where you can't look. And you get a result, never a receipt. So everyone just trusts the house.

meet.mp3
Pinch inherited the arcade. He plays by one rule: show everything. A sealed roll before the drop, and a receipt after it.

how.mp3
Here is how one drop works. You aim, and the pit is already fixed by a public seed. Then your account is sealed inside a private MagicBlock rollup, so even your own wallet can't see the roll. MagicBlock's verifiable randomness draws the number. One transaction opens the seal. And your browser recomputes the whole result from public rules. The sealed room is a hardware enclave, so that is a trust assumption, and we say so.

math.mp3
This is a real receipt from our devnet deployment. The claw was sixty-four percent centered on a pearl, so the hold chance was seventy-seven point oh six percent, fixed before the roll. The sealed roll came out at fifty-seven point nine seven. That is below the chance, so the claw holds. Anyone can rebuild this with the public rules.

live1.mp3
Now, live. Pressing start makes a throwaway wallet, creates the arcade account on Solana, moves it into the private rollup, and logs in to the sealed room.

live2.mp3
Home is a pixel street. I walk to a machine, aim, and drop. The seal goes on first, and these are the real timings of each step. Then the seal opens, and the receipt checks itself in the browser.

live3.mp3
After I save to Solana, this verifier page reads my account straight from devnet and re-checks every receipt. Anyone can do this for any player.

limits.mp3
We are honest about the limits. The sealed room is a hardware enclave: a trust assumption, not trustless. Wallets are throwaway, so the race proves fair rolls, not unique people. Each drop is real transactions, so it is turn-based. And our payout numbers come from our own simulation.

outro.mp3
Pinch's Arcade. The house always wins, until Pinch shows you the receipts. Play it live, and check every drop yourself.

## 2. Screen recording (ONE take, 1 to 2 minutes, real site, real devnet)
- Open an Incognito window (so you get a brand-new wallet and the Start flow shows) at pinchs-arcade.vercel.app.
- Windows: press Win + Alt + R (Game Bar) to start/stop recording the window. Or use OBS.
- Make the browser window about 1280x720 or fullscreen (F11). Zoom 100%. Close other tabs and notifications.
- Do these in order, slowly, pause 1 second between actions:
  1. Press Start playing. Wait until the street appears. (live1)
  2. Walk to Reef Run (or Shell Shop) and press Enter. Aim at a prize, press DROP. Wait for the receipt. Leave it on screen 4 seconds. (live2)
  3. Play 2 more drops quickly (different machines if you can). Close the receipt each time.
  4. Press Missions, then close it. Press Race board, then close it (skip if it errors).
  5. Go to Shelf, press Save to Solana, wait for the toast. Press Verify my receipts (opens the verifier). Wait until it shows VERIFIED rows. (live3)
- Upload the .mp4 to this chat. If it is over the size limit, tell me and I will give you a compression command.
