"""端到端测试：用 Playwright + Edge 以 file:// 打开游戏（等同双击 index.html），截图、测帧率、查报错。

需要：pip install playwright（用本机 Edge，不用下载浏览器）
用法：
  python tools/e2e.py menu                       # 走一遍各菜单界面
  python tools/e2e.py play:house:44:12:12        # play:角色:起始小节:等级:秒数（自动驾驶）
  python tools/e2e.py chest                      # 调试宝箱开箱
  python tools/e2e.py victory                    # 直接打到通关结算
  python tools/e2e.py remix:house                # 10 件乐器满级 + 全 Remix 压力测试
  python tools/e2e.py load:house:150:40:0        # 统计玩家特效亮度负载（自动曝光）
截图输出到系统临时目录下的 beat-survivors-shots/。
"""
import asyncio, json, os, sys, tempfile, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(tempfile.gettempdir()) / "beat-survivors-shots"
OUT.mkdir(exist_ok=True)
URL = ROOT.joinpath("index.html").as_uri()


async def main(mode):
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            channel="msedge",
            headless=True,
            args=["--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
        )
        ctx = await browser.new_context(viewport={"width": 1280, "height": 720}, device_scale_factor=1)
        page = await ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

        if mode == "menu":
            await page.goto(URL)
            await page.wait_for_timeout(800)
            await page.screenshot(path=str(OUT / "01_boot.png"))
            await page.mouse.click(640, 360)
            await page.wait_for_timeout(1500)
            await page.screenshot(path=str(OUT / "02_menu.png"))
            await page.click("button[data-act=play]")
            await page.wait_for_timeout(800)
            await page.screenshot(path=str(OUT / "03_chars.png"))
            await page.click("#scr-chars button[data-act=back]")
            await page.click("button[data-act=shop]")
            await page.wait_for_timeout(500)
            await page.screenshot(path=str(OUT / "04_shop.png"))
            await page.click("#scr-shop button[data-act=back]")
            await page.click("button[data-act=ach]")
            await page.wait_for_timeout(500)
            await page.screenshot(path=str(OUT / "05_ach.png"))
            await page.click("#scr-ach button[data-act=back]")
            await page.click("button[data-act=settings]")
            await page.wait_for_timeout(500)
            await page.screenshot(path=str(OUT / "06_settings.png"))
            await page.click("#scr-settings button[data-act=back]")
            await page.click("button[data-act=help]")
            await page.wait_for_timeout(500)
            await page.screenshot(path=str(OUT / "07_help.png"))
            info = await page.evaluate("({state: Game.state, audio: AE.A.live && AE.A.live.ctx.state, gl: R.ok})")
            print(json.dumps(info, ensure_ascii=False))
        elif mode.startswith("play"):
            # play:style:bar:lv:seconds
            _, style, bar, lv, secs = mode.split(":")
            await page.goto(URL + f"?bot&god&debug&unlock&play={style}&bar={bar}&lv={lv}")
            await page.wait_for_timeout(500)
            await page.mouse.click(640, 360)
            secs = float(secs)
            t0 = time.time()
            k = 0
            while time.time() - t0 < secs:
                await page.wait_for_timeout(int(secs * 1000 / 4))
                k += 1
                await page.screenshot(path=str(OUT / f"play_{style}_{bar}_{k}.png"))
            stats = await page.evaluate("(() => { const s = Debug.stats(); return {fps: s.fps, avg: s.avg, worst: s.worst, work: s.workAvg, workMax: s.workMax, late: s.lateAvg, lateMax: s.lateMax, enemies: W.enemies.length, sprites: Game.lastSprites, state: Game.state, bar: Seq.S.bar}; })()")
            print(json.dumps(stats, ensure_ascii=False))
        elif mode == "chest":
            await page.goto(URL + "?debug&unlock&play=house&lv=8")
            await page.wait_for_timeout(500)
            await page.mouse.click(640, 360)
            await page.wait_for_timeout(2500)
            # 先把升级都选掉
            for _ in range(12):
                st = await page.evaluate("Game.state")
                if st == "levelup":
                    await page.keyboard.press("Enter")
                    await page.wait_for_timeout(250)
            print("before c:", await page.evaluate("({state: Game.state, pend: W.pendingLevels, chests: W.pendingChests, debug: Game.debug, active: document.activeElement && document.activeElement.outerHTML.slice(0,80)})"))
            await page.evaluate("window.__keys = []; window.addEventListener('keydown', e => window.__keys.push(e.code + ':' + e.key), true)")
            await page.keyboard.press("KeyC")
            await page.wait_for_timeout(100)
            print("keys:", await page.evaluate("window.__keys"))
            await page.wait_for_timeout(300)
            print("after c:", await page.evaluate("({state: Game.state, pend: W.pendingLevels, chests: W.pendingChests, screen: Screens.current})"))
            await page.wait_for_timeout(2300)
            await page.screenshot(path=str(OUT / "chest.png"))
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(600)
            info = await page.evaluate("({state: Game.state, inst: W.inst, fx: W.fx})")
            print(json.dumps(info, ensure_ascii=False))
        elif mode == "victory":
            await page.goto(URL + "?bot&god&unlock&play=house&lv=30&bar=193")
            await page.wait_for_timeout(500)
            await page.mouse.click(640, 360)
            await page.wait_for_timeout(4000)
            await page.evaluate("for (const e of W.enemies) if (e.boss) e.hp = 1;")
            await page.wait_for_timeout(1500)
            await page.screenshot(path=str(OUT / "victory_1.png"))
            # 尾声 16 小节约 30 秒；加速：跳到尾声末尾
            await page.evaluate("Seq.S.bar = Math.max(Seq.S.bar, Song.byId('outro').start + 13)")
            for _ in range(30):
                await page.wait_for_timeout(1000)
                if await page.evaluate("Game.state") == "results":
                    break
            await page.wait_for_timeout(800)
            await page.screenshot(path=str(OUT / "victory_results.png"))
            info = await page.evaluate("({state: Game.state, res: Game.runResult && {clear: Game.runResult.clear, grade: Game.runResult.grade, name: Game.runResult.name, score: Game.runResult.score}})")
            print(json.dumps(info, ensure_ascii=False))
        elif mode.startswith("remix"):
            style = mode.split(":")[1] if ":" in mode else "house"
            await page.goto(URL + f"?bot&god&debug&unlock&play={style}&bar=48")
            await page.wait_for_timeout(500)
            await page.mouse.click(640, 360)
            await page.wait_for_timeout(1500)
            await page.evaluate("""() => {
              for (const id of INST_ORDER) { W.inst[id] = 6; W.remix[id] = true; W.fx[INST[id].remix.fx] = 1; }
              W.recompute();
            }""")
            for k in range(3):
                await page.wait_for_timeout(4000)
                await page.screenshot(path=str(OUT / f"remix_{style}_{k}.png"))
            stats = await page.evaluate("(() => { const s = Debug.stats(); return {fps: s.fps, work: s.workAvg, workMax: s.workMax, enemies: W.enemies.length, sprites: Game.lastSprites, parts: W.parts.length, shots: W.shots.length + W.homers.length, beams: W.beams.length, state: Game.state}; })()")
            print(json.dumps(stats, ensure_ascii=False))
        elif mode.startswith("load"):
            # load:style:bar:lv:remix(0/1)
            _, style, bar, lv, rmx = mode.split(":")
            await page.goto(URL + f"?bot&god&debug&unlock&play={style}&bar={bar}&lv={lv}")
            await page.wait_for_timeout(500)
            await page.mouse.click(640, 360)
            await page.wait_for_timeout(1500)
            if rmx == "1":
                await page.evaluate("""() => { for (const id of INST_ORDER) { W.inst[id] = 6; W.remix[id] = true; W.fx[INST[id].remix.fx] = 1; } W.recompute(); }""")
            samples = []
            for k in range(16):
                await page.wait_for_timeout(500)
                samples.append(await page.evaluate("[+(W.fxLoad||0).toFixed(2), +Scene.autoDim.toFixed(2)]"))
            await page.screenshot(path=str(OUT / f"load_{style}_{bar}_{rmx}.png"))
            print(json.dumps({"samples": samples, "inst": await page.evaluate("W.inst")}, ensure_ascii=False))
        print("ERRORS:", json.dumps(errors[:20], ensure_ascii=False))
        await browser.close()


asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "menu"))
