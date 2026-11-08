import sharp from 'sharp';
import {getTransparentCropBounds} from './transparent-crop.mjs';

export async function cropBust(source) {
  const {data, info: {width, height}} = await sharp(source)
    .autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject: true});
  const {left, top, right, bottom} = getTransparentCropBounds({data, width, height});
  const crop = {left, top, width: right - left + 1, height: bottom - top + 1};
  if (crop.width === width && crop.height === height) return source;
  return sharp(data, {raw: {width, height, channels: 4}}).extract(crop).png().toBuffer();
}
