import sharp from 'sharp';

export const IDEOGRAM_MODEL = 'ideogram-ai/ideogram-4-5';
export const FLUX_MODEL = 'black-forest-labs/flux-2-pro';
export const IDEOGRAM_COST = 0.008;

function invalid(message) {
  return Object.assign(new Error(message), {noModelFallback: true});
}

async function download(output) {
  const item = Array.isArray(output) ? output[0] : output;
  const url = typeof item?.url === 'function' ? item.url() : item;
  if (!url) throw new Error('Le modèle ne retourne aucune image');
  const response = await fetch(String(url));
  if (!response.ok) throw new Error('Le média généré est inaccessible');
  return Buffer.from(await response.arrayBuffer());
}

// This API is deployed independently of the editor; canvas work uses Sharp here.
export async function generateAvatarImage(run, originalInput, {signal} = {}) {
  const references = originalInput.input_images || [];
  if (!Array.isArray(references) || references.length > 8 || references.some(image => !Buffer.isBuffer(image) || !image.length)) {
    throw invalid('La génération accepte au maximum 8 images sources valides');
  }
  const rawSeed = originalInput.seed;
  if (rawSeed != null && (!Number.isInteger(rawSeed) || rawSeed < 0 || rawSeed > 2147483647)) {
    throw invalid('Seed invalide');
  }
  const ratio = originalInput.aspect_ratio || '1:1';
  const parts = /^([1-9]\d*):([1-9]\d*)$/.exec(ratio);
  if (!parts) throw invalid('Ratio invalide');
  const megapixels = parseFloat(originalInput.resolution || '1 MP');
  if (!Number.isFinite(megapixels) || megapixels <= 0 || megapixels > 4) throw invalid('Résolution invalide');
  const r = Number(parts[1]) / Number(parts[2]);
  let width = Math.sqrt(megapixels * 1000000 * r), height = width / r;
  const scale = Math.min(1, 2048 / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale)); height = Math.max(1, Math.round(height * scale));
  const sourceSizes = await Promise.all(references.map(async image => {
    try { return await sharp(image).metadata(); }
    catch { throw invalid('Image source invalide'); }
  }));
  const format = originalInput.output_format || 'png';
  if (!['png', 'jpg', 'jpeg', 'webp'].includes(format)) throw invalid('Format de sortie invalide');
  const models = references.length > 5 ? [FLUX_MODEL] : [IDEOGRAM_MODEL, FLUX_MODEL];
  const attempts = [];
  for (const model of models) {
    signal?.throwIfAborted();
    let input = originalInput;
    if (model === IDEOGRAM_MODEL) {
      const images = [...references];
      const source = images[0];
      const sourceSize = sourceSizes[0];
      if (!source || sourceSize.width !== width || sourceSize.height !== height) {
        images[0] = source
          ? await sharp(source).resize(width, height, {fit: 'contain', background: '#000000'}).png().toBuffer()
          : await sharp({create: {width, height, channels: 3, background: '#000000'}}).png().toBuffer();
      }
      input = {prompt: source ? originalInput.prompt
        : `Generate a complete new image across the entire canvas. The black source is an empty placeholder, not scene content. Replace it completely with the following scene: ${originalInput.prompt}`,
      images, size: 'source', quality: 'very_low', num_images: 1};
      if (rawSeed != null) input.seed = rawSeed;
    }
    signal?.throwIfAborted();
    try {
      const raw = await download(await run(model, {input, ...(signal ? {signal} : {})}));
      signal?.throwIfAborted();
      const outputSize = await sharp(raw).metadata();
      if (model === IDEOGRAM_MODEL && Math.abs(outputSize.width / outputSize.height - r) / r > 0.01) {
        throw new Error('Ideogram retourne un ratio inattendu');
      }
      const buffer = model === IDEOGRAM_MODEL
        ? await sharp(raw).resize(width, height, {fit: 'fill'}).toFormat(format === 'jpg' ? 'jpeg' : format).toBuffer()
        : raw;
      const inputMegapixels = sourceSizes.reduce((sum, size) => sum + size.width * size.height / 1000000, 0);
      const outputMegapixels = outputSize.width * outputSize.height / 1000000;
      const cost = model === IDEOGRAM_MODEL ? IDEOGRAM_COST
        : Math.round(0.015 * (1 + inputMegapixels + outputMegapixels) * 1000000) / 1000000;
      attempts.push({model, status: 'success', cost, inputMegapixels, outputMegapixels});
      return {buffer, model, cost, attempts};
    } catch (error) {
      attempts.push({model, status: 'error', cost: null});
      if (signal?.aborted || error.name === 'AbortError' || error.noModelFallback || /cancelled|canceled/i.test(error.message) || model === models.at(-1)) throw error;
    }
  }
}
