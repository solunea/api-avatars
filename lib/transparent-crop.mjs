export const AVATAR_CROP_ALPHA_THRESHOLD = 5;

/**
 * Returns inclusive bounds of pixels whose alpha exceeds the threshold.
 * The input is a decoded RGBA raster in row order. An empty silhouette keeps the full frame.
 */
export function getTransparentCropBounds({data, width, height}, threshold = AVATAR_CROP_ALPHA_THRESHOLD) {
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;

    // Find the first and last visible rows before checking for pixels beyond their horizontal bounds.
    for (let y = 0; y < height; y++) {
        let first = 0;
        while (first < width && data[(y * width + first) * 4 + 3] <= threshold) first++;
        if (first === width) continue;
        top = y;
        left = first;
        let last = width - 1;
        while (last > first && data[(y * width + last) * 4 + 3] <= threshold) last--;
        right = last;
        break;
    }
    for (let y = height - 1; y >= top; y--) {
        let first = 0;
        while (first < width && data[(y * width + first) * 4 + 3] <= threshold) first++;
        if (first === width) continue;
        bottom = y;
        left = Math.min(left, first);
        for (let x = width - 1; x > right; x--) if (data[(y * width + x) * 4 + 3] > threshold) {
            right = x;
            break;
        }
        break;
    }
    for (let y = top + 1; y < bottom && (left > 0 || right < width - 1); y++) {
        for (let x = 0; x < left; x++) if (data[(y * width + x) * 4 + 3] > threshold) {
            left = x;
            break;
        }
        for (let x = width - 1; x > right; x--) if (data[(y * width + x) * 4 + 3] > threshold) {
            right = x;
            break;
        }
    }

    if (left > right || top > bottom) {
        return {left: 0, top: 0, right: width - 1, bottom: height - 1};
    }
    return {left, top, right, bottom};
}
