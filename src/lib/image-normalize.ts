/**
 * Client-side image downscale + re-encode for uploads.
 * Browser-only; safe to import from client components (SSR returns the input unchanged).
 */

const SUPPORTED_INPUT_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

/** Longest edge after normalization when the source is larger than this. */
const MAX_LONG_EDGE_PX = 1800;

const JPEG_MIME = "image/jpeg";
const PNG_MIME = "image/png";
const JPEG_QUALITY = 0.86;

/**
 * Loads a `File` as an HTMLImageElement (decode in the browser).
 * Caller should not use the image after failing — URL is revoked in `loadImageFromFile` on error paths only if we throw before return... Actually we revoke in finally after load success - pattern below.
 */
function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  return new Promise((resolve, reject) => {
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode image"));
    };
    img.src = url;
  });
}

/**
 * Draws the image to a canvas at `targetW` x `targetH` (caller computes dimensions).
 */
function drawImageToCanvas(
  img: HTMLImageElement,
  targetW: number,
  targetH: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(targetW));
  canvas.height = Math.max(1, Math.round(targetH));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }
  // Default compositing; preserves alpha from PNG/WebP when downscaling.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    // Tainted canvas (should not happen for blob URLs) or zero size.
    return false;
  }
  const pixels = data.data;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) return true;
  }
  return false;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas.toBlob returned null"));
      },
      mime,
      quality,
    );
  });
}

/** Strips a single extension and appends the correct suffix for the output MIME type. */
function buildOutputFilename(originalName: string, mime: string): string {
  const withoutExt = originalName.replace(/\.[^./\\]+$/, "");
  const base = withoutExt || "image";
  const ext = mime === PNG_MIME ? "png" : "jpg";
  return `${base}.${ext}`;
}

/**
 * Downscales large JPEG/PNG/WebP images and re-encodes for smaller uploads.
 * GIF and other types are out of scope — returns the input unchanged.
 *
 * @returns A new `File`, or the original `file` if normalization is skipped or fails.
 */
export async function normalizeImageFile(file: File): Promise<File> {
  // No browser / no DOM — cannot process (e.g. SSR import).
  if (typeof window === "undefined" || typeof document === "undefined") {
    return file;
  }

  if (!file.type || !SUPPORTED_INPUT_TYPES.has(file.type)) {
    return file;
  }

  try {
    const img = await loadImageFromFile(file);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) {
      return file;
    }

    const longEdge = Math.max(w, h);
    // No downscale needed — avoid quality loss from re-encoding.
    if (longEdge <= MAX_LONG_EDGE_PX) {
      return file;
    }

    const scale = MAX_LONG_EDGE_PX / longEdge;
    const targetW = w * scale;
    const targetH = h * scale;

    const canvas = drawImageToCanvas(img, targetW, targetH);

    // JPEG sources have no alpha channel — always use JPEG output when we had to resize.
    const sourceIsJpeg = file.type === "image/jpeg" || file.type === "image/jpg";
    const usePng =
      !sourceIsJpeg && hasTransparency(canvas);

    const mime = usePng ? PNG_MIME : JPEG_MIME;
    const blob = usePng
      ? await canvasToBlob(canvas, mime)
      : await canvasToBlob(canvas, JPEG_MIME, JPEG_QUALITY);

    const outName = buildOutputFilename(file.name, mime);
    return new File([blob], outName, {
      type: mime,
      lastModified: Date.now(),
    });
  } catch {
    // Decode, canvas, or export failure — keep upload usable with the original file.
    return file;
  }
}
