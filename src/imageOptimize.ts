const MAX_BYTES = 900 * 1024; // el servidor acepta hasta 1 MB

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
}

/**
 * Reduce una foto del celular (2-5 MB) a WebP de ~1600 px antes de subirla.
 * También corrige la orientación y elimina los metadatos EXIF (ubicación GPS incluida).
 */
export async function optimizeImage(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Usa una foto JPG, PNG o WebP.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('No se pudo leer la foto. Prueba con otra.');
  }
  let side = 1600;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) break;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7]) {
      const webp = await toBlob(canvas, 'image/webp', quality);
      // Navegadores sin codificador WebP devuelven PNG: en ese caso se usa JPEG.
      const blob = webp && webp.type === 'image/webp' ? webp : await toBlob(canvas, 'image/jpeg', quality);
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    side = Math.round(side * 0.75);
  }
  throw new Error('No se pudo optimizar la foto. Prueba con otra.');
}
