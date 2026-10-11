import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import sharp from 'sharp';
import {fitCharacterSheet} from '../lib/sheet-layout.js';

function sheet(rectangles) {
  const image = new PNG({width: 600, height: 450});
  for (const [left, top, width, height, color] of rectangles) {
    for (let y = top; y < top + height; y++) {
      for (let x = left; x < left + width; x++) image.data.set([...color, 255], (y * image.width + x) * 4);
    }
  }
  return PNG.sync.write(image);
}

const red = [230, 20, 20], green = [20, 230, 20], blue = [20, 20, 230];
function bounds(image, channel) {
  const points = {left:image.width, top:image.height, right:0, bottom:0};
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const at = (y * image.width + x) * 4;
      if (image.data[at + 3] < 128 || image.data[at + channel] < 180) continue;
      points.left = Math.min(points.left, x); points.right = Math.max(points.right, x);
      points.top = Math.min(points.top, y); points.bottom = Math.max(points.bottom, y);
    }
  }
  return {...points, width:points.right - points.left + 1, height:points.bottom - points.top + 1};
}

test('des marges différentes donnent trois silhouettes centrées de même hauteur, entièrement visibles', async () => {
  const source = sheet([[65,110,70,300,red], [255,180,30,240,green], [475,50,50,350,blue]]);
  const output = PNG.sync.read(await fitCharacterSheet(source));
  assert.equal(output.width, 2048); assert.equal(output.height, 1536);
  for (let channel = 0; channel < 3; channel++) {
    const box = bounds(output, channel);
    assert.ok(box.height >= 1410 && box.height <= 1414);
    assert.ok(Math.abs((box.left + box.right) / 2 - (channel + .5) * 2048 / 3) < 2);
    assert.ok(Math.abs(box.top - (1536 - box.height) / 2) < 2);
  }
  const repeated = PNG.sync.read(await fitCharacterSheet(PNG.sync.write(output)));
  for (let channel = 0; channel < 3; channel++) {
    assert.ok(Math.abs(bounds(repeated, channel).height - bounds(output, channel).height) < 3);
  }
});

test('une silhouette large limite la hauteur des trois vues sans déformation ni débordement', async () => {
  const output = PNG.sync.read(await fitCharacterSheet(sheet([
    [10,100,180,300,red], [280,90,40,310,green], [470,100,60,300,blue]
  ])));
  const boxes = [0,1,2].map(channel => bounds(output, channel));
  assert.ok(boxes[0].width <= 602);
  assert.ok(boxes[0].left > 0 && boxes[0].right < 2048 / 3);
  assert.ok(boxes.every(box => Math.abs(box.height - boxes[0].height) < 2));
  assert.ok(Math.abs(boxes[0].width / boxes[0].height - .6) < .003);
});

test('les séparateurs corrigés sont utilisés pour extraire les trois vues', async () => {
  const source = sheet([[100,100,100,300,red], [320,110,50,300,green], [480,80,70,300,blue]]);
  const regions = {front:{x:0,y:0,width:.5,height:1}, profile:{x:.5,y:0,width:.2,height:1}, back:{x:.7,y:0,width:.3,height:1}};
  const output = PNG.sync.read(await fitCharacterSheet(source, regions));
  for (let channel = 0; channel < 3; channel++) {
    const box = bounds(output, channel);
    assert.ok(box.left > channel * 2048 / 3 && box.right < (channel + 1) * 2048 / 3);
  }
});

test('un fond opaque et les zones invalides sont refusés, une vue vide préserve la planche', async () => {
  const opaque = await sharp({create:{width:600,height:450,channels:3,background:'white'}}).png().toBuffer();
  await assert.rejects(fitCharacterSheet(opaque), /Retirez le fond/);
  await assert.rejects(fitCharacterSheet(opaque, {front:{},profile:{},back:{}}), /Zone front invalide/);
  await assert.rejects(fitCharacterSheet(opaque, {front:{},profile:{},back:{},face:{}}), /trois vues/);
  const emptyView = sheet([[65,100,70,300,red]]);
  assert.deepEqual(await fitCharacterSheet(emptyView), emptyView);
});
