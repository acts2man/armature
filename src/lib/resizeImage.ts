/**
 * Browser-side image preparation before upload: decode, scale down so the longest
 * edge is at most MAX_IMAGE_WIDTH, and re-encode as WebP. Runs entirely in the
 * browser, so a 12 MB phone photo becomes a few hundred KB before it ever leaves
 * the device. Falls back to JPEG if the browser cannot encode WebP.
 */
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGE_WIDTH } from "@shared/publishTypes.ts";

export type PreparedImage = {
  file: File;
  width: number;
  height: number;
  /** Bytes of the prepared file. */
  bytes: number;
  previewUrl: string;
};

export function isAcceptedImageType(type: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type.toLowerCase());
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to the <img> path
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    image.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Resize and re-encode. Throws an Error with a message safe to show the user.
 */
export async function prepareImage(
  file: File,
  options: { maxWidth?: number; quality?: number } = {},
): Promise<PreparedImage> {
  if (!isAcceptedImageType(file.type)) {
    throw new Error(`Only PNG, JPEG and WebP images can be used — this file is "${file.type || "unknown"}".`);
  }
  const maxWidth = options.maxWidth ?? MAX_IMAGE_WIDTH;
  const quality = options.quality ?? 0.85;

  const source = await decode(file);
  const sourceWidth = "naturalWidth" in source ? source.naturalWidth : source.width;
  const sourceHeight = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (!sourceWidth || !sourceHeight) throw new Error("That image has no size — it may be corrupt.");

  const scale = Math.min(1, maxWidth / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot resize images.");
  context.drawImage(source, 0, 0, width, height);
  if ("close" in source) source.close();

  let blob = await toBlob(canvas, "image/webp", quality);
  let extension = "webp";
  if (!blob || blob.type !== "image/webp") {
    blob = await toBlob(canvas, "image/jpeg", quality);
    extension = "jpg";
  }
  if (!blob) throw new Error("This browser could not encode the image.");

  // Step quality down until the file fits the per-image limit.
  let currentQuality = quality;
  while (blob.size > MAX_IMAGE_BYTES && currentQuality > 0.4) {
    currentQuality -= 0.15;
    const smaller = await toBlob(canvas, blob.type, currentQuality);
    if (!smaller) break;
    blob = smaller;
  }
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Even after resizing, this image is ${(blob.size / 1024 / 1024).toFixed(1)} MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit. Try a smaller or simpler image.`,
    );
  }

  const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
  const prepared = new File([blob], `${baseName}.${extension}`, { type: blob.type });
  return { file: prepared, width, height, bytes: blob.size, previewUrl: URL.createObjectURL(prepared) };
}

/** Base64 of a file, without the data: prefix, for the publish payload. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}
