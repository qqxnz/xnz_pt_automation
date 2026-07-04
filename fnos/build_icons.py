#!/usr/bin/env python3
"""从 designs/pta-icon-1024.png 生成飞牛应用图标。

- 64x64 (应用中心列表)
- 256x256 (详情页)
均为 PNG、不透明、sRGB、直角无圆角（系统或使用处自行渲染圆角）。
"""
import os
from PIL import Image

OUT_DIR = os.path.join(os.path.dirname(__file__), "app", "ui", "images")
os.makedirs(OUT_DIR, exist_ok=True)

ROOT_DIR = os.path.dirname(__file__)
SOURCE_ICON = os.path.join(ROOT_DIR, "..", "designs", "pta-icon-1024.png")

try:
    RESAMPLE = Image.Resampling.LANCZOS
except AttributeError:
    RESAMPLE = Image.LANCZOS


def make_icon(size: int, out_path: str, source: Image.Image):
    img = source.resize((size, size), RESAMPLE).convert("RGB")
    img.save(out_path, "PNG", optimize=True)
    print(f"✅ 生成 {out_path} ({size}x{size})")


if __name__ == "__main__":
    if not os.path.exists(SOURCE_ICON):
        raise SystemExit(f"❌ 源图不存在: {SOURCE_ICON}")

    with Image.open(SOURCE_ICON) as source:
        make_icon(64, os.path.join(ROOT_DIR, "ICON.PNG"), source)
        make_icon(256, os.path.join(ROOT_DIR, "ICON_256.PNG"), source)
        make_icon(64, os.path.join(ROOT_DIR, "app", "ui", "images", "icon_64.png"), source)
        make_icon(256, os.path.join(ROOT_DIR, "app", "ui", "images", "icon_256.png"), source)
    print("全部图标生成完成")
