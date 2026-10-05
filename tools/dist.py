"""把运行时需要的文件（index.html、css/、js/）复制到 dist/，用于部署到静态托管（Cloudflare Pages）。

不做任何编译或压缩：游戏本身就是纯静态文件，dist/ 里的内容和双击 index.html 玩到的完全一样。
用法：python tools/dist.py
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
KEEP = ["index.html", "css", "js"]

if DIST.exists():
    shutil.rmtree(DIST)
DIST.mkdir()
for name in KEEP:
    src = ROOT / name
    if src.is_dir():
        shutil.copytree(src, DIST / name)
    else:
        shutil.copy2(src, DIST / name)

files = [p for p in DIST.rglob("*") if p.is_file()]
size = sum(p.stat().st_size for p in files)
print(f"dist/：{len(files)} 个文件，共 {size / 1024:.0f} KB")
