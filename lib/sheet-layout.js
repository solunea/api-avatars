import sharp from 'sharp';
import {defaultSheetRegions} from './catalog.js';
import {characterSheetLayout} from './sheet-layout-contract.js';

export async function fitCharacterSheet(source, regions = defaultSheetRegions) {
  const {data, info} = await sharp(source).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const layout = characterSheetLayout(data, info.width, info.height, regions);
  if (!layout) return source;
  const layers = await Promise.all(layout.panels.map(async panel => ({
    input:await sharp(source).extract(panel.source).resize(panel.width, panel.height).png().toBuffer(),
    left:panel.left, top:panel.top
  })));
  return sharp({create:{width:layout.width, height:layout.height, channels:4, background:'#00000000'}})
    .composite(layers).png().toBuffer();
}
