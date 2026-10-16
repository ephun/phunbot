"""Build paired synthetic screenshot evidence; run with Pillow installed."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

out = Path(sys.argv[1] if len(sys.argv) > 1 else "../docs/ui-evidence")
names = ["desktop-conversation", "mobile-conversation", "mobile-sidebar", "desktop-goals", "desktop-goal", "desktop-events"]
metrics = []
for name in names:
    reference = Image.open(out / f"reference-{name}.png").convert("RGB")
    implementation = Image.open(out / f"implemented-{name}.png").convert("RGB")
    if reference.size != implementation.size:
        raise RuntimeError(f"Viewport mismatch: {name}")
    delta = ImageChops.difference(reference, implementation)
    channels = delta.split()
    maximum = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
    changed = maximum.point([255 if value > 8 else 0 for value in range(256)]).histogram()[255]
    width, height = reference.size
    paired = Image.new("RGB", (width * 2, height + 24), "#f7f8f6")
    paired.paste(reference, (0, 24))
    paired.paste(implementation, (width, 24))
    draw = ImageDraw.Draw(paired)
    draw.text((8, 6), "Authoritative prototype", fill="#347553")
    draw.text((width + 8, 6), "Implemented API-backed interface", fill="#347553")
    paired.save(out / f"comparison-{name}.png")
    metrics.append({"view": name, "viewport": {"width": width, "height": height}, "pixelsChangedAbove8": changed, "totalPixels": width * height, "changedPercent": round(changed * 100 / (width * height), 4)})
(out / "comparison-summary.json").write_text(json.dumps({"pairs": metrics, "note": "Pixel differences include disclosed production controls, truthful state/criteria labels, and expandable real event payloads; no pixel-perfect claim is made."}, indent=2) + "\n")
print(json.dumps(metrics, indent=2))
