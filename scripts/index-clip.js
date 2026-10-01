import 'dotenv/config';
import Replicate from 'replicate';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readCatalog, saveCatalog} from '../lib/catalog.js';
import {indexAvatarFeatures} from '../lib/clip-features.js';

if (!process.env.REPLICATE_API_TOKEN) throw new Error('REPLICATE_API_TOKEN requis pour indexer les portraits');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const replicate = new Replicate({auth:process.env.REPLICATE_API_TOKEN});
const avatars = readCatalog(root);
for (const avatar of avatars) {
  avatar.clip = await indexAvatarFeatures(root, avatar, replicate);
  // Save each completed portrait, so an interrupted run can resume without paying again.
  saveCatalog(root, avatars);
  console.log(`${avatar.name}: index CLIP prêt (${avatar.clip.embedding.length} dimensions)`);
}
