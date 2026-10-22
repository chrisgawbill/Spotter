import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

/** Compare decoded pixels, keeping review images inside the portable run directory. */
export async function compareScreenshots(headDir, baseDir, runDir) {
  const files = async (dir) => dir ? (await readdir(dir).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  }))?.filter((name) => name.endsWith('.png')) : null;
  const [headFiles, baseFiles] = await Promise.all([files(headDir), files(baseDir)]);
  if (!baseDir) return { status: 'no baseline', changes: [], unchanged: 0 };
  if (!headFiles || !baseFiles) return { status: 'screenshots unavailable', changes: [], unchanged: 0 };
  const changes = [];
  let unchanged = 0;
  let browser;
  try {
    let page;
    for (const name of [...new Set([...headFiles, ...baseFiles])].sort()) {
      const before = baseFiles.includes(name);
      const after = headFiles.includes(name);
      let diff;
      if (before && after) {
        const buffers = await Promise.all([baseDir, headDir].map((dir) => readFile(path.join(dir, name))));
        if (buffers[0].equals(buffers[1])) { unchanged++; continue; }
        if (!page) {
          browser = await chromium.launch();
          page = await browser.newPage();
        }
        diff = await page.evaluate(diffPixels, buffers.map((buffer) => buffer.toString('base64')));
        if (!diff.changedPixels) { unchanged++; continue; }
      }
      await mkdir(path.join(runDir, 'visual', 'before'), { recursive: true });
      if (before) await cp(path.join(baseDir, name), path.join(runDir, 'visual', 'before', name));
      if (diff) await writeFile(path.join(runDir, 'visual', name), Buffer.from(diff.png, 'base64'));
      changes.push({ name, status: !before ? 'added' : !after ? 'removed' : 'changed',
        before: before ? `visual/before/${name}` : null,
        after: after ? `screenshots/${name}` : null,
        diff: diff ? `visual/${name}` : null,
        ...(diff ? { changedPixels: diff.changedPixels } : {}) });
    }
  } finally {
    await browser?.close();
  }
  return { status: 'compared', changes, unchanged };
}

/** Runs in Chromium; different dimensions count as changed even on blank images. */
export async function diffPixels(images) {
  const decoded = await Promise.all(images.map(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    return image;
  }));
  const width = Math.max(...decoded.map((image) => image.width));
  const height = Math.max(...decoded.map((image) => image.height));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const pixels = decoded.map((image) => {
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, width, height).data;
  });
  const output = context.createImageData(width, height);
  let changedPixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const different = x >= decoded[0].width || x >= decoded[1].width ||
      y >= decoded[0].height || y >= decoded[1].height ||
      pixels[0][i] !== pixels[1][i] || pixels[0][i + 1] !== pixels[1][i + 1] ||
      pixels[0][i + 2] !== pixels[1][i + 2] || pixels[0][i + 3] !== pixels[1][i + 3];
    if (different) changedPixels++;
    output.data.set(different ? [255, 0, 100, 255] : [pixels[1][i], pixels[1][i + 1], pixels[1][i + 2], 60], i);
  }
  context.putImageData(output, 0, 0);
  return { changedPixels, png: changedPixels ? canvas.toDataURL('image/png').split(',')[1] : null };
}
