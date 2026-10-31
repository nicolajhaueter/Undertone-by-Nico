const MAX_SIDE = 2000
const QUALITY = 0.9

/**
 * Shrinks an image to at most 2000 px on its longest side and re-encodes it
 * as WebP, which keeps cutout transparency at a fraction of PNG's size.
 * Browsers without a WebP encoder get JPEG for opaque originals and PNG
 * otherwise, so transparency is never lost.
 */
export async function prepareForUpload(source: Blob): Promise<Blob> {
  // Decode like Studio does: <img> accepts some files createImageBitmap rejects.
  const url = URL.createObjectURL(source)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable.')
    context.drawImage(image, 0, 0, width, height)

    const webp = await encode(canvas, 'image/webp')
    if (webp?.type === 'image/webp') return webp
    const fallback = source.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    const encoded = await encode(canvas, fallback)
    if (!encoded) throw new Error('The image could not be encoded.')
    return encoded
  } finally {
    URL.revokeObjectURL(url)
  }
}

const encode = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, QUALITY))
