import type { Request } from 'express';
import sharp from 'sharp';
import { AppError } from '../../shared/errors/app-error.js';

export const IMAGE_BYTE_LIMIT = 5_242_880;
export const IMAGE_PIXEL_LIMIT = 25_000_000;
export const imageContentTypes = ['image/jpeg', 'image/png', 'image/webp'];
const tooLarge = () =>
  new AppError(413, 'PAYLOAD_TOO_LARGE', 'Image exceeds the 5 MiB byte limit');

function hasPngAnimation(bytes: Buffer) {
  // libvips reads APNG's first frame as an ordinary PNG and omits pages metadata.
  // Walk real PNG chunks so compressed pixel bytes cannot trigger a false match.
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);

    if (length > bytes.length - offset - 12)
      throw new Error('Invalid PNG chunk');

    const type = bytes.toString('ascii', offset + 4, offset + 8);

    if (type === 'acTL') return true;
    if (type === 'IEND') return false;

    offset += length + 12;
  }

  return false;
}

/** Called only after live session, role, origin and resource checks. */
export async function readImageBody(req: Request): Promise<Buffer> {
  const declared = req.get('Content-Length');

  if (declared !== undefined && Number(declared) > IMAGE_BYTE_LIMIT) {
    req.resume();

    throw tooLarge();
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;

    req.on('data', (chunk: Buffer) => {
      if (failed) return;

      size += chunk.length;

      if (size > IMAGE_BYTE_LIMIT) {
        failed = true;
        chunks.length = 0;
        reject(tooLarge());
      } else chunks.push(chunk);
    });
    req.once('end', () => {
      if (!failed) resolve(Buffer.concat(chunks, size));
    });
    req.once('error', reject);
    req.once('aborted', () =>
      reject(
        new AppError(400, 'INVALID_IMAGE', 'Image upload was interrupted'),
      ),
    );
  });
}

export async function decodePropertyImage(bytes: Buffer, contentType: string) {
  try {
    const image = sharp(bytes, {
      limitInputPixels: IMAGE_PIXEL_LIMIT,
      failOn: 'warning',
    });
    const metadata = await image.metadata();
    const types: Record<string, string> = {
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
    };

    if (
      !metadata.format ||
      types[metadata.format] !== contentType ||
      (metadata.format === 'png' && hasPngAnimation(bytes)) ||
      (metadata.pages ?? 1) !== 1 ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > IMAGE_PIXEL_LIMIT
    )
      throw new Error('Invalid image metadata');

    const { data, info } = await image
      .autoOrient()
      .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });

    return { data, width: info.width, height: info.height };
  } catch {
    throw new AppError(
      400,
      'INVALID_IMAGE',
      'Upload must be a valid single-frame JPEG, PNG or WebP within the pixel limit and match its Content-Type',
    );
  }
}
