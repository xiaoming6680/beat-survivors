"""生成 README 配图：用 Playwright + Edge 打开真实游戏截图，存到 docs/images/。

需要：pip install playwright pillow；ffmpeg（做 GIF 用，winget 安装的在 PATH 里）
用法：python tools/readme_shots.py [hero|levelup|boss|styles|results|gif|all]
截图 1600×900，JPG 压到约 300KB 以内；GIF 640 宽、4MB 以内。
"""
import asyncio, io, json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "images"
OUT.mkdir(parents=True, exist_ok=True)
URL = (ROOT / "index.html").as_uri()
VIEW = {"width": 1600, "height": 900}
# 跳过新手提示；截图时关掉胶片颗粒（颗粒会让 JPG / GIF 体积暴涨）
INIT = "localStorage.setItem('beat-survivors-v1', JSON.stringify({seenTutorial: true}));"
CLEAN = "R.post.grain = 0; R.post.grainBoost = 0;"


def save_jpg(png_bytes, name, limit=300_000):
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    for q in range(88, 50, -4):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
        if buf.tell() <= limit:
            break
    (OUT / name).write_bytes(buf.getvalue())
    print(f"{name}: {buf.tell() // 1024} KB (q={q})")


async def new_page(p, video_dir=None):
    b = await p.chromium.launch(channel="msedge", headless=True, args=["--autoplay-policy=no-user-gesture-required"])
    kw = {"viewport": VIEW, "device_scale_factor": 1}
    if video_dir:
        kw.update(record_video_dir=video_dir, record_video_size={"width": 1280, "height": 720})
        kw["viewport"] = {"width": 1280, "height": 720}
    ctx = await b.new_context(**kw)
    await ctx.add_init_script(INIT)
    pg = await ctx.new_page()
    return b, ctx, pg


async def start(pg, query):
    await pg.goto(URL + query)
    await pg.wait_for_timeout(500)
    await pg.mouse.click(400, 300)
    await pg.wait_for_timeout(300)
    await pg.evaluate(CLEAN)


async def wait_bar(pg, bar, timeout=30):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if await pg.evaluate("Seq.S.bar") >= bar:
            return
        await pg.wait_for_timeout(50)


async def shot_hero(p, variant=None):
    # 头图候选：Drop 之后几秒、敌人重新聚拢、Boss 开始出招的时候最满
    cands = {
        "house": ("?bot&god&unlock&play=house&bar=46&lv=18&diff=1.6", 48, 5200),
        "synth": ("?bot&god&unlock&play=synthwave&bar=150&lv=32&diff=1.6", 152, 6500),
        "dnb": ("?bot&god&unlock&play=dnb&bar=184&lv=26&diff=1.5", 186, 5000),
    }
    for key in ([variant] if variant else cands):
        q, bar, wait = cands[key]
        b, ctx, pg = await new_page(p)
        await start(pg, q)
        await wait_bar(pg, bar)
        await pg.wait_for_timeout(wait)
        save_jpg(await pg.screenshot(), f"hero_{key}.jpg")
        await b.close()


async def shot_levelup(p):
    b, ctx, pg = await new_page(p)
    await start(pg, "?unlock&play=house&bar=20&lv=5")
    await pg.wait_for_timeout(1500)
    await pg.keyboard.press("ArrowRight")
    await pg.wait_for_timeout(600)
    save_jpg(await pg.screenshot(), "levelup.jpg")
    await b.close()


async def shot_boss(p):
    # 频谱：激光预警 + 落下
    b, ctx, pg = await new_page(p)
    await start(pg, "?bot&god&unlock&play=house&bar=135&lv=22")
    await wait_bar(pg, 136)
    await pg.wait_for_timeout(3300)
    save_jpg(await pg.screenshot(), "boss.jpg")
    await b.close()


async def shot_styles(p):
    b, ctx, pg = await new_page(p)
    await start(pg, "?unlock")
    await pg.wait_for_timeout(1200)
    await pg.click("button[data-act=play]")
    await pg.mouse.move(5, 890)
    await pg.wait_for_timeout(1500)
    save_jpg(await pg.screenshot(), "styles.jpg")
    await b.close()


async def shot_results(p):
    # 用模拟模式跑完一整局，再把结算界面（编曲视图）显示出来
    b, ctx, pg = await new_page(p)
    await pg.goto(URL + "?sim&speed=400&style=house")
    for _ in range(600):
        await pg.wait_for_timeout(500)
        if await pg.evaluate("!!window.__sim"):
            break
    await pg.evaluate("""() => {
      document.getElementById('debug').classList.remove('show');
      UI.show(false);
      document.getElementById('banner').style.display = 'none';
      const r = Game.runResult;
      Game.setAccent(STYLES[r.style]);
      Screens.showResults(r, { notes: Math.round(r.kills / 40 + 30 * r.bossKills.length + (r.clear ? 90 : 0) + r.level * 2), newAch: [] });
    }""")
    await pg.wait_for_timeout(800)
    save_jpg(await pg.screenshot(), "results.jpg")
    await b.close()


async def shot_gif(p):
    # 铺垫倒数 → Drop 全屏冲击 → Boss 进场。用 CDP 逐帧截屏（不依赖 Playwright 自带的录屏 ffmpeg），再用本机 ffmpeg 合成 GIF
    import base64
    tmp = Path(tempfile.mkdtemp())
    b, ctx, pg = await new_page(p)
    await pg.set_viewport_size({"width": 1280, "height": 720})
    cdp = await ctx.new_cdp_session(pg)
    frames = []

    async def on_frame(ev):
        frames.append((ev["metadata"]["timestamp"], ev["data"]))
        try:
            await cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})
        except Exception:
            pass

    cdp.on("Page.screencastFrame", lambda ev: asyncio.ensure_future(on_frame(ev)))
    await start(pg, "?bot&god&unlock&play=house&bar=46&lv=14")
    await wait_bar(pg, 47)
    await cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 85, "maxWidth": 1280, "maxHeight": 720, "everyNthFrame": 1})
    await wait_bar(pg, 48)
    t_drop = time.time()
    await pg.wait_for_timeout(3000)
    await cdp.send("Page.stopScreencast")
    await b.close()
    # 按时间戳重采样成固定帧率
    frames.sort()
    fps = 12
    t_end = frames[-1][0]
    t_start = max(frames[0][0], t_end - 4.2)
    k, j = 0, 0
    t = t_start
    while t <= t_end:
        while j + 1 < len(frames) and frames[j + 1][0] <= t:
            j += 1
        (tmp / f"f{k:04d}.jpg").write_bytes(base64.b64decode(frames[j][1]))
        k += 1
        t += 1 / fps
    print(f"captured {len(frames)} frames, resampled {k}")
    gif = OUT / "play.gif"
    ff = shutil.which("ffmpeg") or "ffmpeg"
    for width, colors in ((640, 112), (600, 96), (560, 80), (480, 64)):
        flt = f"scale={width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors={colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle"
        subprocess.run([ff, "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(tmp / "f%04d.jpg"), "-filter_complex", flt, "-loop", "0", str(gif)], check=True)
        size = gif.stat().st_size
        print(f"play.gif: {size // 1024} KB ({width}px)")
        if size <= 4_000_000:
            break
    shutil.rmtree(tmp, ignore_errors=True)


SHOTS = {"hero": shot_hero, "levelup": shot_levelup, "boss": shot_boss, "styles": shot_styles, "results": shot_results, "gif": shot_gif}


async def main(which):
    async with async_playwright() as p:
        if ":" in which:
            name, arg = which.split(":")
            await SHOTS[name](p, arg)
            return
        for name in (SHOTS if which == "all" else [which]):
            await SHOTS[name](p)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "all"))
