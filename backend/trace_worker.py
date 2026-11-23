#!/usr/bin/env python3
"""
trace_worker.py
----------------
Image -> SVG tracer used by the Node backend. Uses vtracer for the final
tracing pass with an optimised preprocessing pipeline:

AUTO MODE pipeline (Flow AI / flat-art RGBA images):
    upscale (Lanczos, 2400px)
      -> alpha binarisation      (snap semi-transparent anti-alias pixels to 0/255)
      -> edge-clamping           (strengthen outline boundaries before trace)
      -> guided color smoothing  (flatten noise inside color regions, keep edges)
      -> KMeans quantisation     (LAB-space, perceptual)
      -> median cleanup          (remove quantisation speckle)
      -> morphological close     (seal region borders)
      -> vtracer (high-quality params)

MANUAL MODE pipeline: unchanged from original — bilateral denoise + KMeans.

Usage (called from Node via child_process.spawn):
    python3 trace_worker.py <input_path> <output_svg_path> \
        --mode multicolor|grayscale|blackwhite \
        --colors 16 --detail 75 --smoothing 70 --noise 25 --threshold 50

    # Auto mode (Flow AI / flat-art):
    python3 trace_worker.py <input_path> <output_svg_path> --auto

Exits 0 on success (writes SVG to output_svg_path).
Exits 1 on failure (prints a one-line error to stderr for Node to relay).

Dependencies:
    pip install opencv-python-headless numpy Pillow vtracer
"""
import sys
import re
import argparse
import numpy as np
import cv2
from PIL import Image, ImageFilter
import vtracer


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ---------------------------------------------------------------------------
# Preprocessing steps
# ---------------------------------------------------------------------------

def resize_for_detail(img: Image.Image, detail: float, auto_mode: bool = False) -> Image.Image:
    """detail 10-100 -> target width 500-1200px (manual) or fixed 2400px (auto).

    AUTO MODE always upscales to 2400px wide regardless of detail slider —
    Flow AI images are typically 1024-2048px and we need the extra resolution
    so vtracer's curve fitter has tight, well-defined edges to work with.
    Upscaling with LANCZOS before trace is the single biggest quality lever:
    anti-aliasing artefacts that look huge at 1024px become sub-pixel noise
    at 2400px and get cleaned away by the edge-clamping step.

    MANUAL MODE range is unchanged (500-1200px) — existing behaviour preserved."""
    if auto_mode:
        target_w = 2400
    else:
        target_w = round(500 + (clamp(detail, 10, 100) / 100) * 700)
    if img.width != target_w:
        ratio = target_w / img.width
        new_size = (target_w, max(1, round(img.height * ratio)))
        img = img.resize(new_size, Image.LANCZOS)
    return img


# ---------------------------------------------------------------------------
# AUTO-MODE ONLY preprocessing helpers
# These functions are ONLY called from preprocess() when auto_mode=True.
# The manual trace path does NOT call them.
# ---------------------------------------------------------------------------

def binarise_alpha(alpha: Image.Image, threshold: int = 128) -> Image.Image:
    """Snap semi-transparent pixels to fully opaque or fully transparent.

    Flow AI renders with sub-pixel anti-aliasing on every edge, producing
    thousands of pixels with alpha values 1-254.  KMeans treats these as
    separate colours, creating many tiny mixed-colour clusters right on the
    outline boundary — this is the primary source of the jagged/rough edge
    problem.  Binarising alpha before any processing forces a hard boundary
    so every pixel is either 'inside the shape' (alpha=255) or 'outside'
    (alpha=0), leaving no ambiguous fringe for KMeans to get confused by.

    threshold=128: pixels with alpha >= 128 → 255, below → 0.
    This keeps the silhouette shape accurate while removing all the fringe."""
    arr = np.array(alpha)
    binary = np.where(arr >= threshold, 255, 0).astype(np.uint8)
    # Small morphological open to remove stray isolated transparent dots
    kernel = np.ones((3, 3), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    return Image.fromarray(binary)


def enhance_edges(rgb: Image.Image, alpha: Image.Image) -> Image.Image:
    """Strengthen the contrast right at region boundaries before tracing.

    After upscaling and alpha-binarising, the colour regions still have soft
    internal edges (gradients between fill colours, shading transitions).
    vtracer's curve fitter traces where it detects strong colour changes —
    if those changes are gradual, the fitted curve wanders and produces
    wiggly paths.  This step uses an unsharp-mask style boost to make every
    colour boundary crisper without touching the overall tone.

    Only applied to pixels INSIDE the shape (alpha > 0) so we don't create
    dark halos at the outer silhouette."""
    arr = np.array(rgb).astype(np.float32)
    a_arr = np.array(alpha)

    # Gaussian blur of the RGB — subtracting this from original gives edges
    blurred = cv2.GaussianBlur(arr, (0, 0), sigmaX=1.2)
    # Unsharp mask: original + amount * (original - blurred)
    sharpened = arr + 0.6 * (arr - blurred)
    sharpened = np.clip(sharpened, 0, 255).astype(np.uint8)

    # Only apply inside the shape (alpha > 0)
    mask = (a_arr > 0).astype(np.uint8)[:, :, np.newaxis]
    result = sharpened * mask + np.array(rgb) * (1 - mask)
    return Image.fromarray(result.astype(np.uint8))


def guided_color_smooth(rgb: Image.Image, alpha: Image.Image,
                         radius: int = 4, eps: float = 400.0) -> Image.Image:
    """Smooth noise INSIDE each colour region while keeping edges sharp.

    This is fundamentally different from bilateral or Gaussian blur:
    - Gaussian blur: blurs everything uniformly including edges → bad
    - Bilateral filter: edge-preserving but still bleeds colour at narrow gaps
    - Guided filter: uses the image itself as a 'guide' — output is smooth
      where the guide is smooth (flat colour fill) and sharp where the guide
      has strong gradients (outline, colour boundary).

    For Flow AI flat-art this means:
    - The brown body of the acorn → one perfectly flat colour region
    - The dark outline between body and cap → preserved as a hard edge
    - JPEG/PNG compression noise inside the fill → smoothed away

    Result: vtracer sees regions with near-zero internal variation and crisp
    inter-region edges — exactly what it needs to fit clean Bezier curves."""
    arr = np.array(rgb).astype(np.float32) / 255.0
    a_arr = np.array(alpha)

    # Guide = the image itself (self-guided = edge-preserving smooth)
    # cv2.ximgproc.guidedFilter is the clean implementation but requires
    # opencv-contrib; fall back to a fast box-filter approximation if absent.
    try:
        import cv2.ximgproc as ximgproc
        smoothed = ximgproc.guidedFilter(
            guide=arr, src=arr, radius=radius, eps=eps / (255.0 ** 2)
        )
    except (AttributeError, ImportError):
        # Fallback: bilateral filter with tight sigmaColor (similar effect)
        arr8 = np.array(rgb)
        smoothed8 = cv2.bilateralFilter(arr8, d=7, sigmaColor=12, sigmaSpace=12)
        smoothed = smoothed8.astype(np.float32) / 255.0

    smoothed = np.clip(smoothed * 255, 0, 255).astype(np.uint8)

    # Only apply inside the shape
    mask = (a_arr > 0).astype(np.uint8)[:, :, np.newaxis]
    result = smoothed * mask + np.array(rgb) * (1 - mask)
    return Image.fromarray(result)


def bilateral_denoise(img: Image.Image, noise: float, tight: bool = False,
                       tight_sigma_color: float = 15.0) -> Image.Image:
    """Edge-preserving smoothing. Unlike GaussianBlur (which blurs equally
    in all directions, including across edges you want to keep sharp),
    bilateral filtering only smooths regions with *similar* neighboring
    pixel values -- flat/noisy areas get cleaned up, but a strong edge
    (like the outline of the speech bubble) stays crisp. This is the
    single biggest fix for the 'slightly soft/rounded' look vs Illustrator.

    tight=True (used by auto-trace for cartoons/illustrations): sigmaColor is
    kept very small so the filter only merges pixels that are nearly identical
    in colour — it WILL NOT blur across the dark ink outline into the colour
    fills.  This preserves hue accuracy for flat art while still cleaning up
    JPEG compression artefacts and minor noise."""
    if noise < 5:
        return img
    arr = np.array(img.convert("RGB"))
    if tight:
        # Tiny sigmaColor = only merge pixels whose colour difference < ~15 LAB
        # units, so ink outlines act as a hard barrier.  Keep diameter small too.
        d = 5
        sigma_color = float(tight_sigma_color)
        sigma_space = round(clamp(10 + (noise / 100) * 20, 10, 30))
        filtered = cv2.bilateralFilter(arr, d, sigma_color, float(sigma_space))
    else:
        # Standard mode (manual trace) — unchanged from original.
        d = round(clamp(5 + (noise / 100) * 10, 5, 15))
        sigma = round(clamp(20 + (noise / 100) * 80, 20, 100))
        filtered = cv2.bilateralFilter(arr, d, float(sigma), float(sigma))
    return Image.fromarray(filtered)


def quantize_colors_lab(img: Image.Image, n_colors: int) -> Image.Image:
    """True color-count reduction via KMeans clustering in LAB space
    (perceptually uniform, unlike RGB) so visually-similar colors merge
    and visually-distinct colors don't get accidentally lumped together.
    Uses cv2.kmeans (C++ backend) instead of sklearn -- noticeably faster
    on full-resolution images and avoids adding a heavy dependency.

    This is what actually makes the 'Jumlah Warna' slider mean what it
    says, instead of only nudging vtracer's internal comparison precision."""
    arr = np.array(img.convert("RGB"))
    h, w = arr.shape[:2]
    lab = cv2.cvtColor(arr, cv2.COLOR_RGB2LAB)
    samples = lab.reshape(-1, 3).astype(np.float32)

    k = int(clamp(n_colors, 2, 64))
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, centers = cv2.kmeans(
        samples, k, None, criteria, attempts=3, flags=cv2.KMEANS_PP_CENTERS
    )
    centers = np.uint8(centers)
    quantized_lab = centers[labels.flatten()].reshape(h, w, 3)
    quantized_rgb = cv2.cvtColor(quantized_lab, cv2.COLOR_LAB2RGB)
    return Image.fromarray(quantized_rgb)


def estimate_palette_size(lab_samples: np.ndarray, max_k: int = 32, min_k: int = 3,
                           merge_delta_e: float = 6.0, min_share: float = 0.003) -> int:
    """
    Figures out how many perceptually-distinct colors an image *actually*
    has, instead of guessing a color-count band from an "is this a cartoon
    or a photo" label. That label-then-band approach is exactly what made
    the old auto mode inconsistent: two images that are 90% alike but land
    on opposite sides of one threshold (e.g. dark_ratio 0.039 vs 0.041)
    got completely different color counts and therefore completely
    different-looking results.

    Steps:
      1. Over-cluster with KMeans at max_k in LAB space (perceptual).
      2. Drop clusters that cover a negligible share of pixels (these are
         antialiasing/noise, not real colors).
      3. Greedily merge the two closest surviving centers (weighted by
         pixel count) while they're within `merge_delta_e` of each other
         -- i.e. while a viewer wouldn't tell them apart anyway.

    A flat 4-color icon naturally converges to ~4. A busy, many-colored
    illustration converges to ~20+. Nothing has to be told in advance
    which "type" the image is -- the number falls out of the image itself,
    so the same logic behaves consistently across every image.
    """
    total = float(lab_samples.shape[0])
    k0 = min(max_k, max(min_k, int(np.unique(lab_samples.round(0), axis=0).shape[0])))
    k0 = max(k0, min_k)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5)
    _, labels, centers = cv2.kmeans(
        lab_samples, k0, None, criteria, attempts=3, flags=cv2.KMEANS_PP_CENTERS
    )
    counts = np.bincount(labels.flatten(), minlength=k0).astype(np.float64)
    centers = centers.astype(np.float64)

    keep = counts >= total * min_share
    if int(keep.sum()) < min_k:
        order = np.argsort(-counts)[:min_k]
        keep = np.zeros(k0, dtype=bool)
        keep[order] = True

    centers = centers[keep]
    counts = counts[keep]

    while len(centers) > min_k:
        diffs = centers[:, None, :] - centers[None, :, :]
        dists = np.sqrt(np.sum(diffs ** 2, axis=2))
        np.fill_diagonal(dists, np.inf)
        i, j = np.unravel_index(np.argmin(dists), dists.shape)
        if dists[i, j] > merge_delta_e:
            break
        w_i, w_j = counts[i], counts[j]
        merged_center = (centers[i] * w_i + centers[j] * w_j) / (w_i + w_j)
        rest = [x for x in range(len(centers)) if x not in (i, j)]
        centers = np.vstack([centers[rest], merged_center[None, :]])
        counts = np.concatenate([counts[rest], [w_i + w_j]])

    return int(clamp(len(centers), min_k, max_k))


def color_fidelity_delta_e(reference_rgb: np.ndarray, candidate_rgb: np.ndarray) -> float:
    """Mean CIE76 delta-E between two same-scene images, in LAB space, on a
    shared grid. This is the actual, measurable answer to 'does the
    processed image still look like the source' -- far more reliable than
    trusting a heuristic image-type guess, and it applies identically to
    every image instead of only the ones a hand-tuned bucket was built for.
    Rule of thumb: <6 is 'looks the same', 6-12 is a mild but visible
    palette shift, >12 means real colors were lost or merged wrong."""
    h = min(reference_rgb.shape[0], candidate_rgb.shape[0])
    w = min(reference_rgb.shape[1], candidate_rgb.shape[1])
    ref = cv2.resize(reference_rgb, (w, h), interpolation=cv2.INTER_AREA)
    cand = cv2.resize(candidate_rgb, (w, h), interpolation=cv2.INTER_AREA)
    ref_lab = cv2.cvtColor(ref, cv2.COLOR_RGB2LAB).astype(np.float32)
    cand_lab = cv2.cvtColor(cand, cv2.COLOR_RGB2LAB).astype(np.float32)
    delta = np.sqrt(np.sum((ref_lab - cand_lab) ** 2, axis=2))
    return float(np.mean(delta))


def fill_transparent_background(rgb_img: Image.Image, alpha_img: Image.Image) -> Image.Image:
    """Prevents color-bleed halos at alpha edges. Filters below (bilateral,
    KMeans, morphological close) all operate on raw RGB values -- including
    pixels that are fully or partially transparent. In AI-generated PNGs
    those 'invisible' pixels are very often pure black (0,0,0) underneath.
    Left as-is, that hidden black gets blended into the semi-transparent,
    antialiased edge pixels during filtering, producing a dark halo/ring
    right around the shape -- this was the cause of the rough/dark edges
    in the last render, even though the alpha channel itself was correct.

    Fix: inpaint the transparent region with colors extrapolated from the
    nearby opaque pixels *before* any filtering, so no filter ever sees
    the black hiding underneath. The real alpha mask is re-applied after
    all processing, so this fill never appears in the final output."""
    rgb_arr = np.array(rgb_img.convert("RGB"))
    alpha_arr = np.array(alpha_img)
    # Inpaint anything not fully opaque (covers fully transparent pixels
    # AND the semi-transparent antialiased edge ring around the shape).
    mask = (alpha_arr < 250).astype(np.uint8) * 255
    if not mask.any():
        return rgb_img
    inpainted = cv2.inpaint(rgb_arr, mask, 5, cv2.INPAINT_TELEA)
    return Image.fromarray(inpainted)


def smooth_alpha(alpha_img: Image.Image) -> Image.Image:
    """Softens the alpha mask itself so the shape boundary becomes a real
    gradient instead of a hard, pixel-stairstep edge. AI-generated PNGs
    often have alpha that's barely antialiased -- vtracer's spline fitter
    has almost no gradient to work with there, so it ends up tracing every
    pixel step literally, which is the sawtooth/jagged outline you saw.
    A small blur gives it a proper curve to fit through. Also removes any
    tiny isolated speckle in the mask (like stray floating dots some runs
    produced) via a morphological opening."""
    blurred = alpha_img.filter(ImageFilter.GaussianBlur(0.6))
    arr = np.array(blurred)
    _, binary = cv2.threshold(arr, 20, 255, cv2.THRESH_BINARY)
    opened = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    cleaned = np.where(opened > 0, arr, 0).astype(np.uint8)
    return Image.fromarray(cleaned)


def smooth_quantization_noise(img: Image.Image, kernel_size: int = 3) -> Image.Image:
    """KMeans assigns each pixel to a color cluster independently, with no
    spatial awareness. Along gradients (like the light-to-dark shading on
    the bubble) neighboring pixels can flip between two nearly-equidistant
    clusters, leaving a speckled, jagged boundary between color bands
    instead of one clean line. A median filter removes that per-pixel
    noise while keeping real edges intact -- unlike a blur, every output
    pixel is still a real color that existed in the neighborhood, it's
    not inventing new blended colors."""
    arr = np.array(img.convert("RGB"))
    smoothed = cv2.medianBlur(arr, kernel_size)
    return Image.fromarray(smoothed)


def morphological_close(img: Image.Image, kernel_size: int = 2) -> Image.Image:
    """Cleans up small speckle/holes right at color-region borders that
    KMeans quantization can leave behind (a few stray pixels of the
    'wrong' cluster along an edge). Kernel stays small (2-3px) on purpose
    -- too large and it eats real small details (eyes, thin highlights)."""
    if kernel_size < 1:
        return img
    arr = np.array(img.convert("RGB"))
    kernel = np.ones((kernel_size, kernel_size), np.uint8)
    closed = cv2.morphologyEx(arr, cv2.MORPH_CLOSE, kernel)
    return Image.fromarray(closed)


def preprocess(input_path, detail, noise, colors, mode, tight_denoise=False,
               tight_sigma_color=15.0, auto_refine=False, auto_mode=False):
    """Full pipeline dispatcher.

    AUTO MODE  (auto_mode=True) — Flow AI RGBA flat-art optimised:
        upscale(2400px) -> binarise_alpha -> fill_transparent_background
        -> enhance_edges -> guided_color_smooth -> KMeans(LAB)
        -> median cleanup -> morphological close

    MANUAL MODE (auto_mode=False) — original behaviour, byte-for-byte unchanged:
        resize(detail) -> bilateral_denoise -> KMeans(LAB)
        -> median cleanup -> morphological close

    Returns (proc_path, img) where img is the PIL image fed to vtracer."""
    img = Image.open(input_path)

    has_alpha = img.mode in ("RGBA", "LA") or (
        img.mode == "P" and "transparency" in img.info
    )
    img = img.convert("RGBA") if has_alpha else img.convert("RGB")
    img = resize_for_detail(img, detail, auto_mode=auto_mode)

    if auto_mode:
        # ── AUTO PIPELINE ────────────────────────────────────────────────
        # Step 1: Split channels
        if has_alpha:
            rgb = img.convert("RGB")
            alpha = img.split()[-1]
            # Binarise alpha first — removes the anti-alias fringe that
            # creates hundreds of fake "colours" along every outline
            alpha = binarise_alpha(alpha, threshold=128)
            # Inpaint fully-transparent region so no black bleeds through
            rgb = fill_transparent_background(rgb, alpha)
        else:
            rgb = img
            alpha = None

        # Step 2: Edge enhancement — sharpens colour boundaries before trace
        if has_alpha:
            rgb = enhance_edges(rgb, alpha)
        else:
            # For non-alpha images, use a simple unsharp mask
            arr = np.array(rgb).astype(np.float32)
            blurred = cv2.GaussianBlur(arr, (0, 0), sigmaX=1.2)
            sharpened = arr + 0.6 * (arr - blurred)
            rgb = Image.fromarray(np.clip(sharpened, 0, 255).astype(np.uint8))

        # Step 3: Guided smoothing — flatten noise inside regions, keep edges
        if has_alpha:
            rgb = guided_color_smooth(rgb, alpha, radius=4, eps=400.0)
        else:
            arr8 = np.array(rgb)
            smoothed = cv2.bilateralFilter(arr8, d=7, sigmaColor=12, sigmaSpace=12)
            rgb = Image.fromarray(smoothed)

        # Step 4: KMeans colour quantisation in LAB space
        if mode == "multicolor":
            working_colors = int(colors)
            reference_rgb = np.array(rgb.convert("RGB"))

            def _quantize_once(k):
                # Use tighter KMeans convergence for auto mode
                arr_lab = cv2.cvtColor(np.array(rgb.convert("RGB")), cv2.COLOR_RGB2LAB)
                samples = arr_lab.reshape(-1, 3).astype(np.float32)
                h, w = arr_lab.shape[:2]
                k_clamped = int(clamp(k, 2, 64))
                criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.5)
                _, labels, centers = cv2.kmeans(
                    samples, k_clamped, None, criteria,
                    attempts=5, flags=cv2.KMEANS_PP_CENTERS
                )
                centers = np.uint8(centers)
                quantized_lab = centers[labels.flatten()].reshape(h, w, 3)
                quantized_rgb = cv2.cvtColor(quantized_lab, cv2.COLOR_LAB2RGB)
                q = Image.fromarray(quantized_rgb)
                # Larger median kernel (5) for auto — removes more speckle at borders
                q_arr = cv2.medianBlur(np.array(q), 5)
                q = Image.fromarray(q_arr)
                q = morphological_close(q, kernel_size=3)
                return q

            rgb = _quantize_once(working_colors)

            # auto_refine: bump color count if quantisation lost too much fidelity
            if auto_refine:
                for _ in range(3):
                    delta_e = color_fidelity_delta_e(reference_rgb, np.array(rgb.convert("RGB")))
                    if delta_e <= 7.0 or working_colors >= 56:
                        break
                    working_colors = min(56, working_colors + 6)
                    rgb = _quantize_once(working_colors)

        elif mode == "grayscale":
            rgb = rgb.convert("L").convert("RGB")

    else:
        # ── MANUAL PIPELINE — original, untouched ────────────────────────
        if has_alpha:
            rgb = img.convert("RGB")
            alpha = img.split()[-1]
            rgb = fill_transparent_background(rgb, alpha)
            alpha = smooth_alpha(alpha)
        else:
            rgb = img
            alpha = None

        rgb = bilateral_denoise(rgb, noise, tight=tight_denoise,
                                tight_sigma_color=tight_sigma_color)

        if mode == "grayscale":
            rgb = rgb.convert("L").convert("RGB")
        elif mode == "multicolor":
            working_colors = int(colors)
            reference_rgb = np.array(rgb.convert("RGB"))

            def _quantize_once(k):
                q = quantize_colors_lab(rgb, k)
                q = smooth_quantization_noise(q, kernel_size=3)
                q = morphological_close(q, kernel_size=2)
                return q

            rgb = _quantize_once(working_colors)

            if auto_refine:
                for _ in range(2):
                    delta_e = color_fidelity_delta_e(reference_rgb, np.array(rgb.convert("RGB")))
                    if delta_e <= 9.0 or working_colors >= 48:
                        break
                    working_colors = min(48, working_colors + 8)
                    rgb = _quantize_once(working_colors)

    # ── Recombine alpha and save ──────────────────────────────────────────
    if has_alpha:
        if auto_mode:
            # Use the binarised alpha (already computed above)
            final_img = rgb.convert("RGBA")
            final_img.putalpha(alpha)
        else:
            final_img = rgb.convert("RGBA")
            final_img.putalpha(alpha)
    else:
        final_img = rgb

    proc_path = input_path + "_proc.png"
    final_img.save(proc_path)
    return proc_path, final_img


def add_viewbox(svg_path):
    """vtracer emits <svg width="W" height="H"> with NO viewBox. Without a
    viewBox, browsers render the SVG at its literal pixel size instead of
    scaling to fit its container -- this is why the preview looked
    'zoomed in' / cropped in the frontend. Inject a matching viewBox so
    CSS sizing (width:100%/height:100%) can scale it proportionally."""
    with open(svg_path, "r", encoding="utf-8") as f:
        content = f.read()

    m = re.search(r'<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"', content)
    if m and "viewBox" not in content.split(">", 1)[0]:
        w, h = m.group(1), m.group(2)
        content = content.replace(
            f'width="{w}" height="{h}"',
            f'width="{w}" height="{h}" viewBox="0 0 {w} {h}" preserveAspectRatio="xMidYMid meet"',
            1,
        )
        with open(svg_path, "w", encoding="utf-8") as f:
            f.write(content)


def set_output_size(svg_path, output_size: int):
    """Sets the SVG width/height to a fixed output_size (px) while preserving
    the original aspect ratio. The viewBox retains the original coordinate
    space so all paths stay pixel-perfect; only the rendered canvas size changes.

    This solves the 'output ukuran beda-beda' problem: regardless of the source
    image dimensions, every exported SVG will have a consistent long-edge size
    (e.g. 4000px for microstock) while remaining fully scalable as a vector.

    output_size=0 means 'no override' — original dimensions are kept as-is."""
    if output_size <= 0:
        return

    with open(svg_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Match width/height already written by add_viewbox() or vtracer
    m = re.search(r'<svg([^>]*)\swidth="([\d.]+)"([^>]*)\sheight="([\d.]+)"', content)
    if not m:
        # Try alternate attribute order (height before width)
        m = re.search(r'<svg([^>]*)\sheight="([\d.]+)"([^>]*)\swidth="([\d.]+)"', content)
        if not m:
            return  # Can't parse dimensions — leave file unchanged

    # Detect attribute order
    svg_tag_raw = content[m.start():m.end()]
    if 'width' in svg_tag_raw and svg_tag_raw.index('width') < svg_tag_raw.index('height'):
        orig_w = float(m.group(2))
        orig_h = float(m.group(4))
    else:
        orig_h = float(m.group(2))
        orig_w = float(m.group(4))

    if orig_w <= 0 or orig_h <= 0:
        return

    # Scale so the LONGEST edge equals output_size (portrait & landscape both handled)
    scale = output_size / max(orig_w, orig_h)
    new_w = round(orig_w * scale)
    new_h = round(orig_h * scale)

    # Find the opening <svg ...> tag precisely — skip any leading <?xml ...?> declaration
    svg_tag_start = content.index('<svg')
    svg_tag_end   = content.index('>', svg_tag_start) + 1
    svg_open = content[svg_tag_start:svg_tag_end]
    before   = content[:svg_tag_start]
    rest     = content[svg_tag_end:]

    svg_open = re.sub(r'\bwidth="[\d.]+"',  f'width="{new_w}"',  svg_open, count=1)
    svg_open = re.sub(r'\bheight="[\d.]+"', f'height="{new_h}"', svg_open, count=1)

    # Ensure viewBox covers original coordinate space (don't change it)
    if "viewBox" not in svg_open:
        svg_open = svg_open.replace(
            f'width="{new_w}"',
            f'width="{new_w}" viewBox="0 0 {round(orig_w)} {round(orig_h)}"',
            1,
        )

    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(before + svg_open + rest)


def trace(proc_path, img, out_path, mode, colors, detail, smoothing, noise, threshold,
          output_size: int = 0, auto_mode: bool = False):
    # ---- map UI sliders (0-100 style) onto vtracer's native ranges ----
    color_precision = 8 if mode == "multicolor" else round(clamp(5 + (colors - 2) / 30 * 3, 5, 8))

    if auto_mode:
        # AUTO MODE: parameters tuned for Flow AI flat-art
        # After our preprocessing the image already has clean, flat colour
        # regions with hard edges — so we tell vtracer to:
        #   - trust small regions (filter_speckle=2, not 4+)
        #   - fit curves aggressively (corner_threshold=60, keeps roundness)
        #   - use max path precision (path_precision=8)
        #   - many iterations for best curve fit (max_iterations=30)
        #   - low length_threshold to capture fine detail
        filter_speckle    = 2
        corner_threshold  = 60
        length_threshold  = 1.5
        path_precision    = 8
        splice_threshold  = 45
        max_iterations    = 30
    else:
        # MANUAL MODE: unchanged from original
        filter_speckle = round(clamp(1 + (noise / 100) * 8, 1, 10))
        corner_threshold = round(clamp(50 + (smoothing / 100) * 100, 50, 150))
        length_threshold = round(clamp(4 - (detail / 100) * 3.5, 0.5, 4), 2)
        path_precision   = round(clamp(4 + (detail / 100) * 6, 4, 10))
        splice_threshold = round(clamp(50 + (smoothing / 100) * 70, 50, 120))
        max_iterations   = 10

    common = dict(
        hierarchical     = "stacked",
        mode             = "spline",
        filter_speckle   = filter_speckle,
        color_precision  = color_precision,
        corner_threshold = corner_threshold,
        length_threshold = length_threshold,
        max_iterations   = max_iterations,
        splice_threshold = splice_threshold,
        path_precision   = path_precision,
    )

    if mode == "blackwhite":
        bw_level = round(clamp(threshold, 1, 99) / 100 * 255)
        bw = img.convert("L").point(lambda p: 255 if p >= bw_level else 0)
        bw_path = proc_path + "_bw.png"
        bw.convert("RGB").save(bw_path)
        vtracer.convert_image_to_svg_py(
            bw_path, out_path, colormode="bw", **common
        )
    else:
        vtracer.convert_image_to_svg_py(
            proc_path, out_path, colormode="color", **common
        )

    add_viewbox(out_path)
    set_output_size(out_path, output_size)


# ---------------------------------------------------------------------------
# Auto-preset: analyze image and pick optimal tracing parameters
# ---------------------------------------------------------------------------

def _lerp(a, b, t):
    t = clamp(t, 0.0, 1.0)
    return a + (b - a) * t


def analyze_image_auto(input_path: str) -> dict:
    """
    Analyzes the source image and returns the best tracing parameters
    automatically — like Vector Magic's fully-automatic mode.

    v2: the previous version picked one of several fixed presets
    (bw / logo / cartoon / photo / flat / fallback) based on hard
    thresholds calibrated against a single test image. That worked well
    for images that looked like the test image and could look noticeably
    "off" -- wrong color count, wrong smoothing -- for anything that fell
    just on the other side of a threshold, since two nearly-identical
    images could land in two completely different preset branches.

    This version instead:
      1. Estimates the palette size directly from the image's own colors
         (estimate_palette_size) instead of guessing a color-count band
         from an image "type".
      2. Computes a single continuous 0-1 "texture_score" (flat/graphic
         art -> 0, photographic -> 1) from edge density, luminance
         variance and local texture, and *blends* noise/detail/smoothing
         along that continuum instead of jumping between fixed tables.
         A borderline image now gets borderline parameters, not a coin
         flip between two very different looks.
      3. Leaves the actual color-fidelity check to preprocess()'s
         auto_refine loop, which measures the real output instead of
         trusting this analysis alone.

    is_bw (pure black & white) and is_logo (flat-color image with a
    transparent background) are kept as explicit switches because they
    genuinely change which code path applies (blackwhite threshold mode,
    or a tighter color cap for logos) -- not because of a stylistic
    preference between two similar presets.
    """
    img_pil = Image.open(input_path)

    has_alpha = img_pil.mode in ("RGBA", "LA") or (
        img_pil.mode == "P" and "transparency" in img_pil.info
    )

    # Analyse on a thumbnail for speed — 400px wide keeps enough detail
    # for the edge and color metrics to be reliable.
    thumb = img_pil.convert("RGBA") if has_alpha else img_pil.convert("RGB")
    scale = min(1.0, 400 / max(thumb.width, 1))
    analysis_size = (max(1, int(thumb.width * scale)), max(1, int(thumb.height * scale)))
    thumb = thumb.resize(analysis_size, Image.LANCZOS)
    rgb_thumb = thumb.convert("RGB")
    arr = np.array(rgb_thumb)
    total_pixels = arr.shape[0] * arr.shape[1]

    lab = cv2.cvtColor(arr, cv2.COLOR_RGB2LAB)
    samples = lab.reshape(-1, 3).astype(np.float32)

    # ── Adaptive palette size (see estimate_palette_size docstring) ──────
    significant_clusters = estimate_palette_size(
        samples, max_k=32, min_k=3, merge_delta_e=6.0, min_share=0.003
    )

    # ── Edge density (Canny) ──────────────────────────────────────────────
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 40, 120)
    edge_density = float(np.count_nonzero(edges)) / total_pixels

    # ── Gradient smoothness — L* std ──────────────────────────────────────
    l_channel = lab[:, :, 0].astype(float)
    l_std = float(np.std(l_channel))          # flat art ≈ 15-30, photo ≈ 35-65

    # ── Saturation (a*/b* channels are 0-255 in OpenCV LAB, neutral=128) ──
    ab = lab[:, :, 1:3].astype(float) - 128.0
    saturation_mean = float(np.mean(np.abs(ab)))  # near 0 = grey/bw

    # ── Local texture (Laplacian variance) ────────────────────────────────
    laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    # ── Ink-outline signal ─────────────────────────────────────────────────
    # Fraction of near-black pixels. A cartoon/illustration with a bold ink
    # outline can still have HIGH l_std/laplacian_var (saturated color
    # blocks butting up against each other are high-contrast), which on
    # its own would misread as "photographic". The presence of a real
    # outline is a more direct, harder-to-fool signal that this is graphic
    # art, so it pulls texture_score back down regardless of what the
    # contrast-based signals say.
    hsv = cv2.cvtColor(arr, cv2.COLOR_RGB2HSV)
    dark_ratio = float(np.count_nonzero(hsv[:, :, 2] < 50)) / total_pixels

    is_bw = saturation_mean < 6 and significant_clusters <= 4
    is_logo = has_alpha and significant_clusters <= 10 and not is_bw

    if is_bw:
        mode = "blackwhite"
        colors, detail, smoothing, noise, threshold = 2, 88, 70, 10, 50
        tight_denoise, tight_sigma_color = True, 15.0

    else:
        # Continuous 0 (flat/graphic) -> 1 (photographic) score
        l_term = clamp((l_std - 18) / (50 - 18), 0.0, 1.0)
        lap_term = clamp((laplacian_var - 300) / (2500 - 300), 0.0, 1.0)
        edge_term = clamp((0.10 - edge_density) / (0.10 - 0.02), 0.0, 1.0)
        outline_term = clamp((dark_ratio - 0.01) / (0.10 - 0.01), 0.0, 1.0)
        texture_score = clamp(
            0.28 * l_term + 0.24 * lap_term + 0.22 * edge_term + 0.26 * (1.0 - outline_term),
            0.0, 1.0,
        )

        mode = "multicolor"

        # For Flow AI flat-art: be GENEROUS with colour count.
        # Under-counting colours is the #1 cause of patchy shading in the
        # output — a cartoon with 18 real colours forced into 12 will have
        # visible "wrong" regions where two similar shades got merged.
        # We give extra headroom: significant_clusters + lerp(6, 10) buffer,
        # capped higher than before (56 instead of 40).
        colors = significant_clusters + round(_lerp(6, 10, texture_score))
        if is_logo:
            colors = max(6, min(colors, 24))
        else:
            colors = int(clamp(colors, 6, 56))

        # Auto mode: detail/smoothing/noise are fixed — the trace() function
        # uses its own hard-coded auto params, these values are just passed
        # through for reference / UI display.
        detail    = 92
        smoothing = 50
        noise     = 8
        threshold = 50

        # tight_denoise not used in new auto pipeline (guided_color_smooth
        # replaced it) — kept in preset dict for backward compat only.
        tight_denoise     = True
        tight_sigma_color = 12.0

    preset = dict(
        mode=mode,
        colors=int(round(colors)),
        detail=int(round(detail)),
        smoothing=int(round(smoothing)),
        noise=int(round(noise)),
        threshold=int(threshold),
        tight_denoise=bool(tight_denoise),
        tight_sigma_color=float(tight_sigma_color),
    )

    print(
        f"[auto-analyze] clusters={significant_clusters} edges={edge_density:.3f} "
        f"l_std={l_std:.1f} sat={saturation_mean:.1f} dark={dark_ratio:.3f} "
        f"lap={laplacian_var:.0f} has_alpha={has_alpha} is_bw={is_bw} is_logo={is_logo} "
        f"-> {preset}",
        file=sys.stderr
    )

    return preset


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input_path")
    ap.add_argument("output_path")
    ap.add_argument("--auto", action="store_true",
                    help="Analyze image and auto-select best tracing parameters")
    ap.add_argument("--mode", default="multicolor",
                     choices=["multicolor", "grayscale", "blackwhite"])
    ap.add_argument("--colors", type=float, default=16)
    ap.add_argument("--detail", type=float, default=75)
    ap.add_argument("--smoothing", type=float, default=70)
    ap.add_argument("--noise", type=float, default=25)
    ap.add_argument("--threshold", type=float, default=50)
    ap.add_argument("--output-size", type=int, default=0,
                    help="Target output size in px (longest edge). 0 = no resize.")
    args = ap.parse_args()

    try:
        output_size = max(0, args.output_size)

        if args.auto:
            # Fully automatic mode: analyze image and pick best preset
            preset = analyze_image_auto(args.input_path)
            mode      = preset["mode"]
            colors    = preset["colors"]
            detail    = preset["detail"]
            smoothing = preset["smoothing"]
            noise     = preset["noise"]
            threshold = preset["threshold"]
            # Use tight bilateral denoise for graphic/illustration-like images
            # so the filter never bleeds colour across ink outlines.
            tight_denoise = preset.get("tight_denoise", True)
            tight_sigma_color = preset.get("tight_sigma_color", 15.0)
            auto_refine = True
            auto_mode = True
            # Echo preset as JSON on stdout so Node can pass it back to frontend
            import json
            print(json.dumps({"preset": preset}))
        else:
            mode         = args.mode
            colors       = args.colors
            detail       = args.detail
            smoothing    = args.smoothing
            noise        = args.noise
            threshold    = args.threshold
            tight_denoise = False   # manual mode: use original behaviour unchanged
            tight_sigma_color = 15.0
            auto_refine = False     # manual mode: never auto-adjust the user's own settings
            auto_mode = False

        proc_path, img = preprocess(
            args.input_path, detail, noise, colors, mode,
            tight_denoise=tight_denoise,
            tight_sigma_color=tight_sigma_color,
            auto_refine=auto_refine,
            auto_mode=auto_mode,
        )
        trace(
            proc_path, img, args.output_path,
            mode, colors, detail, smoothing,
            noise, threshold,
            output_size=output_size,
            auto_mode=auto_mode,
        )
    except Exception as e:
        print(f"trace_worker error: {e}", file=sys.stderr)
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()