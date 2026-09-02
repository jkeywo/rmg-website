import fs from 'node:fs';
import path from 'node:path';

const MONTHS = new Map([
  ['January', 0], ['February', 1], ['March', 2], ['April', 3],
  ['May', 4], ['June', 5], ['July', 6], ['August', 7],
  ['September', 8], ['October', 9], ['November', 10], ['December', 11]
]);

export const ALLOWED_FIELDS = new Set([
  'name', 'slug', 'date', 'venue', 'location', 'tagline', 'description',
  'tickets', 'listImage', 'bannerImage', 'photos', 'theme', 'complexity'
]);

function removeBlockIndent(value) {
  const lines = value.split('\n');
  const populated = lines.filter(line => line.trim());
  const indent = populated.length
    ? Math.min(...populated.map(line => line.match(/^\s*/)[0].length))
    : 0;
  return lines.map(line => line.slice(Math.min(indent, line.length))).join('\n').trim();
}

export function parseNeon(text, sourceName = 'games.neon') {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const records = [];
  let current = null;
  let blockKey = null;
  let blockLines = [];

  const flushBlock = () => {
    if (current && blockKey) current[blockKey] = removeBlockIndent(blockLines.join('\n'));
    blockKey = null;
    blockLines = [];
  };

  const flushRecord = () => {
    flushBlock();
    if (current && Object.keys(current).length) records.push(current);
    current = null;
  };

  lines.forEach((line, index) => {
    if (line.trim() === '-') {
      flushRecord();
      current = {};
      return;
    }

    if (blockKey) {
      if (/^[A-Za-z][A-Za-z0-9]*:\s*/.test(line)) {
        flushBlock();
      } else {
        blockLines.push(line);
        return;
      }
    }

    if (!line.trim()) return;
    const match = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!match) {
      throw new Error(`${sourceName}:${index + 1}: expected "field: value" or "-"`);
    }
    if (!current) current = {};
    const [, key, rawValue] = match;
    if (!ALLOWED_FIELDS.has(key)) {
      throw new Error(`${sourceName}:${index + 1}: unsupported field "${key}"`);
    }
    if (Object.hasOwn(current, key)) {
      throw new Error(`${sourceName}:${index + 1}: duplicate field "${key}"`);
    }
    if (rawValue === '|') {
      blockKey = key;
      blockLines = [];
    } else {
      current[key] = rawValue.trim();
    }
  });

  flushRecord();
  return records;
}

export function parseGameDate(value, context = 'date') {
  const match = String(value ?? '').match(/^(\d{1,2}) ([A-Z][a-z]+) (\d{4})$/);
  if (!match || !MONTHS.has(match[2])) {
    throw new Error(`${context}: expected a date such as "10 October 2026"`);
  }
  const day = Number(match[1]);
  const month = MONTHS.get(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    throw new Error(`${context}: invalid calendar date "${value}"`);
  }
  return date;
}

export function utcDateKey(date) {
  return date.toISOString().slice(0, 10);
}

export function isPastAt(gameDate, now) {
  const gameKey = utcDateKey(gameDate);
  const nowKey = utcDateKey(now);
  if (gameKey < nowKey) return true;
  if (gameKey > nowKey) return false;
  return now.getUTCHours() >= 16;
}

export function hasGameOnUtcDate(games, date) {
  const target = utcDateKey(date);
  return games.some(game => utcDateKey(game.dateObj ?? parseGameDate(game.date, `${game.slug || game.name}: date`)) === target);
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

export function markdownToHtml(value) {
  if (!value) return '';
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .split(/\n\s*\n/)
    .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

export function safeExternalUrl(value, context) {
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${context}: invalid URL "${value}"`);
  }
  if (url.protocol !== 'https:') throw new Error(`${context}: only HTTPS URLs are allowed`);
  return url.href;
}

export function safeRelativePath(value, context) {
  const normalized = String(value ?? '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..') || /[?#]/.test(normalized)) {
    throw new Error(`${context}: unsafe relative path "${value}"`);
  }
  return normalized;
}

export function validateGames(records, rootDirectory) {
  if (!records.length) throw new Error('No games were found');
  const slugs = new Set();
  return records.map((record, index) => {
    const context = record.slug || record.name || `record ${index + 1}`;
    for (const field of ['name', 'slug', 'date', 'description', 'listImage', 'bannerImage']) {
      if (!record[field]) throw new Error(`${context}: missing required field "${field}"`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.slug)) {
      throw new Error(`${context}: slug must contain lowercase letters, numbers, and hyphens only`);
    }
    if (slugs.has(record.slug)) throw new Error(`${context}: duplicate slug`);
    slugs.add(record.slug);

    const listImage = safeRelativePath(record.listImage, `${context}: listImage`);
    const bannerImage = safeRelativePath(record.bannerImage, `${context}: bannerImage`);
    const photos = record.photos
      ? record.photos.split(',').map(name => safeRelativePath(name.trim(), `${context}: photo`)).filter(Boolean)
      : [];
    const imagePaths = [listImage, bannerImage, ...photos.map(name => `photos/${record.slug}/${name}`)];
    for (const imagePath of imagePaths) {
      if (!fs.existsSync(path.join(rootDirectory, imagePath))) {
        throw new Error(`${context}: missing image "${imagePath}"`);
      }
    }

    return {
      ...record,
      tickets: safeExternalUrl(record.tickets, `${context}: tickets`),
      listImage,
      bannerImage,
      photos,
      dateObj: parseGameDate(record.date, `${context}: date`)
    };
  });
}

export function readGames(sourcePath, rootDirectory = process.cwd()) {
  const absolute = path.resolve(rootDirectory, sourcePath);
  if (!fs.existsSync(absolute)) throw new Error(`Game source does not exist: ${sourcePath}`);
  return validateGames(parseNeon(fs.readFileSync(absolute, 'utf8'), sourcePath), rootDirectory);
}
