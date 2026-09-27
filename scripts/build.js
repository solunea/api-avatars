import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildCatalog} from '../lib/catalog.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const index = buildCatalog(root);
console.log(`API générée : ${index.length} avatar(s)`);
