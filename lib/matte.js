import {PNG} from 'pngjs';
import {removeWhiteFringePixels} from './matte-pixels.js';

export function removeWhiteFringe(sourceBuffer, cutoutBuffer) {
  const source = PNG.sync.read(sourceBuffer), cutout = PNG.sync.read(cutoutBuffer);
  if (source.width !== cutout.width || source.height !== cutout.height) return cutoutBuffer;
  return removeWhiteFringePixels(source.data, cutout.data, cutout.width, cutout.height)
    ? PNG.sync.write(cutout, {colorType:6}) : cutoutBuffer;
}
