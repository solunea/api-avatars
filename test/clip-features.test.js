import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CLIP_MODEL, normalizeClipFeature, indexAvatarFeatures} from '../lib/clip-features.js';

test('avatar index is cached by portrait fingerprint and invalidated when the image changes', async t => {
  const root = mkdtempSync(join(tmpdir(), 'avatar-clip-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  mkdirSync(join(root, 'images'));
  const portrait = join(root, 'images', 'portrait.png');
  writeFileSync(portrait, 'first image');
  const avatar = {tones:{neutral:'images/portrait.png'}};
  let uploads = 0, predictions = 0, deletions = 0;
  const replicate = {files:{
    create:async () => {uploads++; return {id:'file1', urls:{get:'https://example.com/upload.png'}};},
    delete:async () => {deletions++;}
  }, run:async model => {
    assert.equal(model, CLIP_MODEL); predictions++;
    return [{input:'https://example.com/rewritten.png', embedding:[2, ...Array(767).fill(0)]}];
  }};
  avatar.clip = await indexAvatarFeatures(root, avatar, replicate);
  assert.equal(avatar.clip.embedding[0], 1);
  await indexAvatarFeatures(root, avatar, replicate);
  assert.deepEqual([uploads, predictions, deletions], [1, 1, 1]);
  writeFileSync(portrait, 'different image');
  assert.equal(await indexAvatarFeatures(root, avatar, null), undefined);
  const replaced = await indexAvatarFeatures(root, avatar, replicate);
  assert.notEqual(replaced.imageHash, avatar.clip.imageHash);
  assert.deepEqual([uploads, predictions, deletions], [2, 2, 2]);
});

test('invalid dimensions, nonfinite values and zero vectors are rejected', () => {
  const feature = {model:CLIP_MODEL, imageHash:'a'.repeat(64), embedding:[1, ...Array(767).fill(0)]};
  assert.ok(normalizeClipFeature(feature));
  for (const changes of [{model:'other'}, {imageHash:'invalid'}, {embedding:[1]}, {embedding:Array(768).fill(0)},
    {embedding:[NaN, ...Array(767).fill(0)]}]) assert.equal(normalizeClipFeature({...feature, ...changes}), undefined);
});
