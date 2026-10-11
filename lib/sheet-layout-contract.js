// Géométrie commune aux rendus Sharp et Canvas ; seuls les pixels alpha définissent les silhouettes.
export function characterSheetLayout(data, imageWidth, imageHeight, regions) {
  const names = ['front', 'profile', 'back'];
  if (!regions || Object.keys(regions).length !== 3 || !names.every(name => regions[name])) {
    throw new Error('Le cadrage nécessite une planche à trois vues : face, profil et dos.');
  }
  const panels = [];
  let transparent = false;
  for (const name of names) {
    const region = regions[name];
    if (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(region[key]))
      || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
      || region.x + region.width > 1.000001 || region.y + region.height > 1.000001) {
      throw new Error(`Zone ${name} invalide`);
    }
    const left = Math.round(region.x * imageWidth), top = Math.round(region.y * imageHeight);
    const right = Math.min(imageWidth, Math.round((region.x + region.width) * imageWidth));
    const bottom = Math.min(imageHeight, Math.round((region.y + region.height) * imageHeight));
    let x0 = right, y0 = bottom, x1 = left - 1, y1 = top - 1;
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const alpha = data[(y * imageWidth + x) * 4 + 3];
        if (alpha === 0) transparent = true;
        if (alpha <= 8) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    panels.push(x1 < x0 ? null : {left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1});
  }
  if (!transparent) throw new Error('Retirez le fond de la planche avant d’ajuster le cadrage.');
  // Ne pas déplacer les autres vues si l'une des zones ne contient aucune silhouette.
  if (panels.some(panel => !panel)) return null;
  const width = 2048, height = 1536;
  const panelWidth = width / 3;
  const subjectHeight = Math.max(1, Math.floor(Math.min(height * .92,
    ...panels.map(panel => panelWidth * .88 * panel.height / panel.width))));
  return {width, height, panels:panels.map((panel, index) => {
    const subjectWidth = Math.max(1, Math.round(panel.width * subjectHeight / panel.height));
    return {source:panel, width:subjectWidth, height:subjectHeight,
      left:Math.round(index * panelWidth + (panelWidth - subjectWidth) / 2), top:Math.round((height - subjectHeight) / 2)};
  })};
}
