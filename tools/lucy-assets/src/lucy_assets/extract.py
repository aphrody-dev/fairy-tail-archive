from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

REPOSITORY = Path(__file__).resolve().parents[4]
DEFAULT_INPUT = REPOSITORY / "data/lucy-research/user-page.png"
DEFAULT_OUTPUT = REPOSITORY / "var/lucy-assets/lucy-figure-extract-v2.png"
PREVIEW_WIDTH = 1311
PREVIEW_HEIGHT = 1882

# Landmark coordinates are normalized from the user-visible 1311x1882 preview.
# They form a loose outer envelope; GrabCut seeds classify background gaps.
ENVELOPE = [
    (820, 242), (900, 255), (942, 274), (966, 300), (988, 333), (1032, 365),
    (1090, 430), (1160, 484), (1202, 520), (1196, 545), (1163, 575),
    (1118, 606), (1078, 634), (1030, 662), (1012, 684), (1037, 726),
    (1052, 780), (1058, 850), (1052, 960), (1043, 1080), (1036, 1175),
    (1037, 1200), (1000, 1224), (980, 1310), (964, 1430), (954, 1570),
    (954, 1740), (960, 1881), (738, 1881), (728, 1730), (706, 1580),
    (682, 1435), (653, 1290), (637, 1220), (632, 1190), (641, 1145),
    (660, 1090), (676, 1032), (677, 970), (668, 930), (644, 883), (613, 830),
    (576, 787), (531, 752), (494, 724), (477, 694), (477, 640), (480, 602),
    (493, 568), (519, 528), (549, 480), (584, 430), (614, 375), (650, 320),
    (681, 270), (739, 248),
]

# Confirmed foreground samples within the character (preview coordinates).
FOREGROUND = [
    (890, 320, 16), (850, 430, 15), (960, 435, 15), (875, 575, 14),
    (605, 515, 14), (565, 615, 16), (1130, 450, 14), (1160, 520, 15),
    (860, 850, 18), (960, 940, 20), (830, 1160, 22), (950, 1390, 18),
    (780, 1670, 20), (960, 1670, 20), (835, 1840, 20), (900, 1830, 18),
]

# Confirmed background samples within the envelope, especially the gaps between
# arms, hair, torso and legs. These avoid all visible line art.
BACKGROUND = [
    (520, 280, 18), (650, 300, 16), (1065, 290, 18), (1275, 340, 16),
    (500, 900, 20), (1250, 900, 20), (510, 1150, 18), (1220, 1240, 20),
    (520, 1600, 20), (1220, 1700, 20), (550, 1800, 18), (1260, 1800, 18),
]


def map_xy(x: float, y: float, width: int, height: int) -> tuple[int, int]:
    return round(x * width / PREVIEW_WIDTH), round(y * height / PREVIEW_HEIGHT)


def apply_seeds(mask: np.ndarray, samples: list[tuple[int, int, int]], label: int) -> None:
    height, width = mask.shape
    for x, y, radius in samples:
        px, py = map_xy(x, y, width, height)
        r = max(1, round(radius * min(width / PREVIEW_WIDTH, height / PREVIEW_HEIGHT)))
        cv2.circle(mask, (px, py), r, label, -1, lineType=cv2.LINE_8)


def mask_image(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    mask = np.full((height, width), cv2.GC_BGD, dtype=np.uint8)
    envelope = np.array([map_xy(x, y, width, height) for x, y in ENVELOPE], np.int32)
    cv2.fillPoly(mask, [envelope], cv2.GC_PR_FGD)
    apply_seeds(mask, FOREGROUND, cv2.GC_FGD)
    apply_seeds(mask, BACKGROUND, cv2.GC_BGD)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    cv2.setRNGSeed(20261103)
    cv2.grabCut(image, mask, None, bgd_model, fgd_model, 8, cv2.GC_INIT_WITH_MASK)
    alpha = np.where(
        (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0
    ).astype(np.uint8)
    # Preserve every seeded foreground component, including thin separated
    # locks and fingertips. Exclude all components with no confirmed foreground.
    count, labels = cv2.connectedComponents(alpha, connectivity=8)
    keep = np.zeros(count, dtype=bool)
    for x, y, _ in FOREGROUND:
        px, py = map_xy(x, y, width, height)
        keep[labels[py, px]] = True
    return np.where(keep[labels], alpha, 0).astype(np.uint8)


def encode_pixel_exact_svg(rgba: np.ndarray, output: Path, source_url: str) -> int:
    height, width = rgba.shape[:2]
    groups: dict[tuple[int, int, int, int], list[str]] = defaultdict(list)
    for y in range(height):
        row = rgba[y]
        x = 0
        while x < width:
            r, g, b, a = (int(v) for v in row[x])
            if a == 0:
                x += 1
                continue
            end = x + 1
            while end < width and np.array_equal(row[end], row[x]):
                end += 1
            groups[(r, g, b, a)].append(f"M{x} {y}h{end-x}v1h-{end-x}z")
            x = end
    chunks = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" shape-rendering="crispEdges">',
        "<metadata>Pixel-run vectorization of the human-reviewed mask; exact source RGB preserved. "
        f"Reference: {source_url}. No generated or embedded raster image.</metadata>",
    ]
    for rgba_color in sorted(groups):
        r, g, b, a = rgba_color
        opacity = a / 255
        chunks.append(
            f'<path fill="#{r:02x}{g:02x}{b:02x}" fill-opacity="{opacity:.8g}" '
            f'd="{"".join(groups[rgba_color])}"/>'
        )
    chunks.append("</svg>")
    output.write_text("\n".join(chunks), encoding="utf-8")
    return sum(len(paths) for paths in groups.values())


def main() -> None:
    parser = argparse.ArgumentParser(description="Non-AI, source-pixel-preserving Lucy extraction")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--svg", type=Path, default=None, help="Optional exact RGB pixel-run SVG")
    parser.add_argument("--source-url", default="https://bigsolo.org/manga/fairy-tail-refantasia/1/3")
    args = parser.parse_args()

    source_bytes = args.input.read_bytes()
    image = cv2.imdecode(np.frombuffer(source_bytes, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit(f"Cannot decode source image: {args.input}")
    alpha = mask_image(image)
    ys, xs = np.where(alpha > 0)
    if len(xs) == 0:
        raise SystemExit("The mask contains no foreground pixels")
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    pad = 2
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(alpha.shape[1], x1 + pad), min(alpha.shape[0], y1 + pad)
    crop = image[y0:y1, x0:x1]
    crop_alpha = alpha[y0:y1, x0:x1]
    rgba = cv2.cvtColor(crop, cv2.COLOR_BGR2RGBA)
    rgba[:, :, 3] = crop_alpha

    args.output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba).save(args.output, optimize=False)
    vector_path_count = None
    if args.svg:
        args.svg.parent.mkdir(parents=True, exist_ok=True)
        vector_path_count = encode_pixel_exact_svg(rgba, args.svg, args.source_url)
    report = {
        "method": "opencv-grabcut-with-human-seeded-normalized-landmarks",
        "nonAi": True,
        "source": args.source_url,
        "sourceFileSha256": hashlib.sha256(source_bytes).hexdigest(),
        "sourceSize": [image.shape[1], image.shape[0]],
        "previewCoordinateBasis": [PREVIEW_WIDTH, PREVIEW_HEIGHT],
        "coordinateMapping": "x and y scaled independently into source pixel dimensions",
        "extractionCrop": [x0, y0, x1, y1],
        "outputSize": [x1 - x0, y1 - y0],
        "foregroundPixels": int(np.count_nonzero(crop_alpha)),
        "alphaValues": sorted(int(v) for v in np.unique(crop_alpha)),
        "outputPng": str(args.output),
        "outputPngSha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
        "outputSvg": str(args.svg) if args.svg else None,
        "svgPixelRuns": vector_path_count,
        "reviewStatus": "unreviewed",
        "limits": [
            "silhouette still requires visual review and manual edge correction",
            "visible page crop ends at the lower legs",
            "back, side view, and hidden anatomy are not present in the source",
        ],
    }
    report_path = args.output.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
