// Retirer seulement les pixels blancs ajoutés par le détourage, en bord de masque.
export function removeWhiteFringePixels(source, data, width, height) {
    const distance = new Uint16Array(width * height);
    const far = 1000;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const at = y * width + x;
            if (data[at * 4 + 3] < 16) continue;
            distance[at] = Math.min(far, x ? distance[at - 1] + 1 : far,
                y ? distance[at - width] + 1 : far);
        }
    }
    for (let y = height - 1; y >= 0; y--) {
        for (let x = width - 1; x >= 0; x--) {
            const at = y * width + x;
            distance[at] = Math.min(distance[at], x + 1 < width ? distance[at + 1] + 1 : far,
                y + 1 < height ? distance[at + width] + 1 : far);
        }
    }

    let changed = false;
    for (let pixel = 0; pixel < distance.length; pixel++) {
        if (distance[pixel] > 64) continue;
        const at = pixel * 4;
        if (!data[at + 3]) continue;
        const red = data[at];
        const green = data[at + 1];
        const blue = data[at + 2];
        const brightness = (red + green + blue) / 3;
        const originalBrightness = (source[at] + source[at + 1] + source[at + 2]) / 3;
        if (brightness >= 140 && brightness - originalBrightness >= 45
            && Math.max(red, green, blue) - Math.min(red, green, blue) <= 50) {
            data[at + 3] = 0;
            changed = true;
        }
    }
    return changed;
}
