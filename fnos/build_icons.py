#!/usr/bin/env python3
"""生成 xnz-pt-automation 飞牛应用图标
- 64x64 (应用中心列表)
- 256x256 (详情页)
均为 PNG、不透明、sRGB、直角无圆角（系统自动渲染圆角）
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.join(os.path.dirname(__file__), "app", "ui", "images")
os.makedirs(OUT_DIR, exist_ok=True)

def make_icon(size: int, out_path: str):
    img = Image.new("RGB", (size, size), (26, 36, 56))
    draw = ImageDraw.Draw(img)

    pad = int(size * 0.15625)
    inner_size = size - 2 * pad
    radius = int(size * 0.094)

    for y in range(inner_size):
        t = y / max(inner_size - 1, 1)
        r = int(79 * (1 - t) + 47 * t)
        g = int(140 * (1 - t) + 111 * t)
        b = int(255 * (1 - t) + 224 * t)
        draw.line([(pad, pad + y), (pad + inner_size - 1, pad + y)], fill=(r, g, b))

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle(
        [pad, pad, pad + inner_size, pad + inner_size],
        radius=radius,
        fill=(47, 111, 224, 90),
    )
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)

    accent = int(size * 0.094)
    inner_pad = pad + accent
    inner_w = inner_size - 2 * accent
    inner_h = inner_size - 2 * accent

    arrow_h = int(inner_h * 0.30)
    arrow_y_top = inner_pad + int(inner_h * 0.22)
    arrow_y_mid = arrow_y_top + arrow_h
    stem_w = int(inner_w * 0.18)
    head_w = int(inner_w * 0.50)

    cx = inner_pad + inner_w // 2
    left = cx - head_w // 2
    right = cx + head_w // 2
    stem_left = cx - stem_w // 2
    stem_right = cx + stem_w // 2

    poly = [
        (left, arrow_y_top),
        (cx, arrow_y_top - int(arrow_h * 0.35)),
        (right, arrow_y_top),
        (stem_right, arrow_y_mid - 1),
        (stem_right, arrow_y_mid + int(arrow_h * 0.15)),
        (stem_left, arrow_y_mid + int(arrow_h * 0.15)),
        (stem_left, arrow_y_mid - 1),
    ]
    draw.polygon(poly, fill=(255, 255, 255))

    try:
        font_paths = [
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/SFCompact.ttf",
            "/Library/Fonts/Arial.ttf",
        ]
        font = None
        for fp in font_paths:
            if os.path.exists(fp):
                font = ImageFont.truetype(fp, int(size * 0.22))
                break
        if font is None:
            font = ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    text = "PT"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    text_y = arrow_y_mid + int(inner_h * 0.10)
    draw.text(
        (cx - tw // 2 - bbox[0], text_y - bbox[1]),
        text,
        fill=(255, 255, 255),
        font=font,
    )

    img.save(out_path, "PNG", optimize=True)
    print(f"✅ 生成 {out_path} ({size}x{size})")


if __name__ == "__main__":
    root = os.path.dirname(__file__)
    make_icon(64, os.path.join(root, "ICON.PNG"))
    make_icon(256, os.path.join(root, "ICON_256.PNG"))
    make_icon(64, os.path.join(root, "app", "ui", "images", "icon_64.png"))
    make_icon(256, os.path.join(root, "app", "ui", "images", "icon_256.png"))
    print("全部图标生成完成")
