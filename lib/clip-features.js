import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mediaPath} from './catalog.js';

export const CLIP_MODEL = 'andreasjansson/clip-features:75b33f253f7714a281ad3e9b28f63e3232d583716ef6718f2e46641077ea040a';
export function normalizeClipFeature(feature) {
  if (feature?.model !== CLIP_MODEL || !/^[a-f0-9]{64}$/.test(feature.imageHash || '')
    || !Array.isArray(feature.embedding) || feature.embedding.length !== 768
    || feature.embedding.some(number => typeof number !== 'number' || !Number.isFinite(number))) return undefined;
  const norm = Math.hypot(...feature.embedding);
  return norm > 0 ? {...feature, embedding:feature.embedding.map(number => number / norm)} : undefined;
}

/** The portrait fingerprint invalidates the hidden index as soon as the image changes. */
export async function indexAvatarFeatures(root, avatar, replicate) {
  const path = mediaPath(root, avatar.tones?.neutral || avatar.preview);
  if (!path) throw new Error('Portrait CLIP absent');
  const bytes = readFileSync(path);
  const imageHash = createHash('sha256').update(bytes).digest('hex');
  const existing = normalizeClipFeature(avatar.clip);
  if (existing?.imageHash === imageHash) return existing;
  if (!replicate) return undefined;
  const signal = AbortSignal.timeout(60000);
  const file = await replicate.files.create(new Blob([bytes], {type:path.endsWith('.jpg') ? 'image/jpeg' : 'image/png'}), {}, {signal});
  try {
    if (!/^https:\/\//.test(file?.urls?.get || '')) throw new Error('Upload CLIP absent');
    const output = await replicate.run(CLIP_MODEL, {input:{inputs:file.urls.get}, signal});
    const feature = normalizeClipFeature({model:CLIP_MODEL, imageHash,
      // One input produces one vector; uploaded URIs can be rewritten to signed delivery URLs.
      embedding:Array.isArray(output) && output.length === 1 ? output[0]?.embedding : null});
    if (!feature) throw new Error('Vecteur CLIP invalide');
    return feature;
  } finally {
    if (file?.id) await replicate.files.delete(file.id).catch(() => {});
  }
}
