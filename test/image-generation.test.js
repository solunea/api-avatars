import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {generateAvatarImage, IDEOGRAM_MODEL, FLUX_MODEL} from '../lib/image-generation.js';

const source = await sharp({create: {width: 32, height: 32, channels: 3, background: '#ff0000'}}).png().toBuffer();
const data = bytes => `data:image/png;base64,${bytes.toString('base64')}`;
const basic = {prompt: 'Original scene', aspect_ratio: '1:1', resolution: '0.01 MP', output_format: 'png'};

test('uses a black source without an invalid all-black mask for text-only generation', async () => {
    let request;
    const result = await generateAvatarImage(async (model, options) => {
        request = {model, input: options.input}; return [data(options.input.images[0])];
    }, basic);
    assert.equal(request.model, IDEOGRAM_MODEL);
    assert.equal(request.input.quality, 'very_low');
    assert.equal(request.input.num_images, 1);
    assert.equal(request.input.size, 'source');
    assert.equal(request.input.mask, undefined);
    assert.match(request.input.prompt, /empty placeholder/);
    assert.deepEqual((await sharp(request.input.images[0]).raw().toBuffer()).every(value => value === 0), true);
    assert.equal(result.model, IDEOGRAM_MODEL);
    assert.equal(result.cost, 0.008);
    assert.equal(result.attempts.length, 1);
});

test('prepares a canvas without distorting the first source and keeps remaining references in order', async () => {
    let input;
    const result = await generateAvatarImage(async (_model, options) => {
        input = options.input; return data(input.images[0]);
    }, {...basic, input_images: [source, source], aspect_ratio: '2:1', seed: 42});
    assert.deepEqual(input.images[1], source);
    assert.equal(input.seed, 42);
    assert.equal(input.prompt, basic.prompt);
    assert.equal('input_images' in input, false);
    assert.equal('resolution' in input, false);
    const {width, height} = await sharp(result.buffer).metadata();
    assert.ok(Math.abs(width / height - 2) / 2 < 0.01);
});

test('Flux receives the original inputs after an Ideogram failure and reports its own estimated cost', async () => {
    const original = {...basic, input_images: [source]};
    const requests = [];
    const result = await generateAvatarImage(async (model, options) => {
        requests.push({model, input: options.input});
        if (model === IDEOGRAM_MODEL) throw Error('HTTP 502');
        return data(source);
    }, original);
    assert.deepEqual(requests.map(item => item.model), [IDEOGRAM_MODEL, FLUX_MODEL]);
    assert.equal(requests[1].input, original);
    assert.deepEqual(requests[1].input.input_images, [source]);
    assert.equal(result.model, FLUX_MODEL);
    assert.notEqual(result.cost, 0.008);
    assert.deepEqual(result.attempts.map(attempt => attempt.status), ['error', 'success']);
});

test('six references go straight to Flux and none are discarded', async () => {
    const requests = [];
    const result = await generateAvatarImage(async (model, options) => {
        requests.push({model, input: options.input}); return data(source);
    }, {...basic, input_images: Array(6).fill(source)});
    assert.equal(result.model, FLUX_MODEL);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].input.input_images.length, 6);
});

test('invalid source, seed and ratio fail before a paid request; cancellation stops fallback', async () => {
    let calls = 0;
    for (const options of [{seed: -1}, {aspect_ratio: 'invalid'}, {input_images: [Buffer.from('invalid')]}, {input_images: Array(9).fill(source)}]) {
        await assert.rejects(generateAvatarImage(async () => {calls++;}, {...basic, ...options}));
    }
    assert.equal(calls, 0);
    const controller = new AbortController();
    await assert.rejects(generateAvatarImage(async () => {
        calls++; controller.abort(); throw new DOMException('Cancelled', 'AbortError');
    }, basic, {signal: controller.signal}), /Cancelled/);
    assert.equal(calls, 1);
});
