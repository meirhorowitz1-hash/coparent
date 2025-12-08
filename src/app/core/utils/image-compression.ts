export interface ImageCompressionOptions {
  maxDimension?: number;
  maxBytes?: number;
  initialQuality?: number;
  minQuality?: number;
  qualityStep?: number;
  scaleStep?: number;
  minScale?: number;
}

function readImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject('invalid-data-url');
        return;
      }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject('image-load-failed');
      img.src = reader.result;
    };
    reader.onerror = () => reject('read-failed');
    reader.readAsDataURL(file);
  });
}

export function getDataUrlSize(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.ceil((base64.length * 3) / 4);
}

export async function compressImageFile(
  file: File,
  options: ImageCompressionOptions = {}
): Promise<string | null> {
  const {
    maxDimension = 1400,
    maxBytes = 900 * 1024,
    initialQuality = 0.92,
    minQuality = 0.35,
    qualityStep = 0.07,
    scaleStep = 0.9,
    minScale = 0.25
  } = options;

  const img = await readImage(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  let scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  scale = Math.max(minScale, scale);

  while (scale >= minScale) {
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    let quality = initialQuality;
    while (quality >= minQuality) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (getDataUrlSize(dataUrl) <= maxBytes) {
        return dataUrl;
      }
      quality = Math.max(minQuality, quality - qualityStep);
      if (quality === minQuality) {
        break;
      }
    }

    if (scale <= minScale) {
      break;
    }

    scale = Math.max(minScale, scale * scaleStep);
  }

  return null;
}
