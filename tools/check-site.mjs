import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(process.argv[2] || 'dist');
const files = [];

async function collect(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(absolute);
    else files.push(absolute);
  }
}

function localPath(value) {
  if (!value || /^(?:https?:|mailto:|data:|#)/i.test(value)) return null;
  const clean = decodeURIComponent(value.split(/[?#]/)[0]).replace(/^\/+/, '');
  return clean;
}

function candidates(value) {
  const relative = localPath(value);
  if (relative === null) return [];
  if (!relative) return ['index.html'];
  if (path.extname(relative)) return [relative];
  return [relative, `${relative}.html`, path.join(relative, 'index.html')];
}

await collect(root);
const relativeFiles = new Set(files.map(file => path.relative(root, file).replaceAll('\\', '/')));
const errors = [];
const htmlFiles = files.filter(file => file.endsWith('.html'));

for (const htmlFile of htmlFiles) {
  const html = await fs.readFile(htmlFile, 'utf8');
  const relativeHtml = path.relative(root, htmlFile).replaceAll('\\', '/');
  if (!/<link rel="canonical" href="https?:\/\//.test(html)) errors.push(`${relativeHtml}: missing canonical URL`);
  if (!/<main\b/.test(html) || !/<h1\b/.test(html)) errors.push(`${relativeHtml}: missing semantic main heading`);
  if (/<(?:script|img|source)[^>]+(?:src|srcset)="https?:\/\//i.test(html)) {
    errors.push(`${relativeHtml}: eager third-party runtime resource`);
  }
  for (const iframeTag of html.match(/<iframe\b[^>]*>/gi) || []) {
    if (/\bsrc="https?:\/\//i.test(iframeTag) && !/\bloading="lazy"/i.test(iframeTag)) {
      errors.push(`${relativeHtml}: eager third-party iframe`);
    }
  }

  const attributes = html.matchAll(/\b(?:href|src)="([^"]+)"/g);
  for (const match of attributes) {
    const value = match[1].replaceAll('&amp;', '&');
    const options = candidates(value);
    if (options.length && !options.some(option => relativeFiles.has(option.replaceAll('\\', '/')))) {
      errors.push(`${relativeHtml}: missing target ${value}`);
    }
  }

  for (const match of html.matchAll(/\bsrcset="([^"]+)"/g)) {
    for (const candidate of match[1].split(',')) {
      const value = candidate.trim().split(/\s+/)[0];
      const options = candidates(value);
      if (options.length && !options.some(option => relativeFiles.has(option.replaceAll('\\', '/')))) {
        errors.push(`${relativeHtml}: missing srcset target ${value}`);
      }
    }
  }
}

const manifest = JSON.parse(await fs.readFile(path.join(root, 'build-manifest.json'), 'utf8'));
if (manifest.environment === 'staging') {
  for (const htmlFile of htmlFiles) {
    const html = await fs.readFile(htmlFile, 'utf8');
    if (!html.includes('name="robots" content="noindex,nofollow"')) {
      errors.push(`${path.relative(root, htmlFile)}: staging page is indexable`);
    }
  }
}

const scripts = files.filter(file => /assets[\\/]code[\\/]interactions\..+\.js$/.test(file));
if (scripts.length !== 1) errors.push('Expected exactly one interaction script');
else {
  const compressed = zlib.gzipSync(await fs.readFile(scripts[0]));
  if (compressed.length > 5 * 1024) errors.push(`Interaction JavaScript is ${compressed.length} compressed bytes (budget: 5120)`);
}

const homeHtml = await fs.readFile(path.join(root, 'index.html'), 'utf8');
let initialTransfer = zlib.gzipSync(Buffer.from(homeHtml)).length;
for (const match of homeHtml.matchAll(/<(?:link|script)[^>]+(?:href|src)="([^"]+)"[^>]*>/g)) {
  const options = candidates(match[1]);
  const relative = options.find(option => relativeFiles.has(option.replaceAll('\\', '/')));
  if (relative && /\.(?:css|js)$/.test(relative)) {
    initialTransfer += zlib.gzipSync(await fs.readFile(path.join(root, relative))).length;
  }
}
for (const match of homeHtml.matchAll(/<picture>([\s\S]*?<img [^>]*loading="eager"[^>]*>)[\s\S]*?<\/picture>/g)) {
  const sourceSet = match[1].match(/<source type="image\/avif" srcset="([^"]+)"/);
  if (!sourceSet) continue;
  const choices = sourceSet[1].split(',').map(candidate => {
    const [url, width] = candidate.trim().split(/\s+/);
    return { url, width: Number(width.replace(/w$/, '')) };
  }).sort((a, b) => a.width - b.width);
  const chosen = choices.find(choice => choice.width >= 400) || choices.at(-1);
  const relative = candidates(chosen.url)[0];
  if (relative && relativeFiles.has(relative.replaceAll('\\', '/'))) {
    initialTransfer += (await fs.stat(path.join(root, relative))).size;
  }
}
if (initialTransfer > 500 * 1024) {
  errors.push(`Initial mobile home transfer is ${initialTransfer} bytes (budget: 512000)`);
}

if (errors.length) {
  console.error(`Site validation failed with ${errors.length} problem(s):`);
  errors.slice(0, 100).forEach(error => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`Validated ${htmlFiles.length} HTML pages and ${relativeFiles.size} generated files.`);
  console.log(`Estimated initial mobile transfer: ${initialTransfer} bytes.`);
}
