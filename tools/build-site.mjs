import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import {
  escapeHtml,
  isPastAt,
  markdownToHtml,
  readGames,
  safeExternalUrl,
  utcDateKey
} from './site-lib.mjs';

const ROOT = process.cwd();
const PRODUCTION_URL = 'https://readingmegagames.co.uk/';
const ENVIRONMENTS = new Set(['local', 'staging', 'production']);

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (!argument.startsWith('--') || !values[index + 1]) throw new Error(`Invalid argument: ${argument}`);
    result[argument.slice(2)] = values[index + 1];
    index += 1;
  }
  return result;
}

function hash(buffer, length = 12) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, length);
}

function slugPart(value) {
  return path.parse(value).name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
}

function attrs(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => value === true ? key : `${key}="${escapeHtml(value)}"`)
    .join(' ');
}

class AssetBuilder {
  constructor(output, pathPrefix) {
    this.output = output;
    this.pathPrefix = pathPrefix;
    this.images = new Map();
  }

  url(relative) {
    return `${this.pathPrefix}${relative}`.replace(/\/{2,}/g, '/');
  }

  async writeBuffer(directory, filename, buffer) {
    const targetDirectory = path.join(this.output, 'assets', directory);
    await fs.mkdir(targetDirectory, { recursive: true });
    await fs.writeFile(path.join(targetDirectory, filename), buffer);
    return this.url(`assets/${directory}/${filename}`);
  }

  async file(source, directory, label) {
    const buffer = await fs.readFile(path.join(ROOT, source));
    const extension = path.extname(source).toLowerCase();
    const filename = `${label}.${hash(buffer)}${extension}`;
    return this.writeBuffer(directory, filename, buffer);
  }

  async image(source, widths) {
    const normalizedWidths = [...new Set(widths)].sort((a, b) => a - b);
    const cacheKey = `${source}:${normalizedWidths.join(',')}`;
    if (this.images.has(cacheKey)) return this.images.get(cacheKey);

    const promise = (async () => {
      const absolute = path.join(ROOT, source);
      const original = await fs.readFile(absolute);
      const metadata = await sharp(original).metadata();
      if (!metadata.width || !metadata.height) throw new Error(`${source}: unable to read image dimensions`);
      const outputWidths = [...new Set(normalizedWidths.map(width => Math.min(width, metadata.width)))];
      const base = slugPart(source);
      const originalExtension = path.extname(source).toLowerCase();
      const originalName = `${base}.${hash(original)}${originalExtension}`;
      const src = await this.writeBuffer('media', originalName, original);

      const variants = { avif: [], webp: [] };
      for (const width of outputWidths) {
        const pipeline = sharp(original).rotate().resize({ width, withoutEnlargement: true });
        const avif = await pipeline.clone().avif({ quality: 55, effort: 4 }).toBuffer();
        const webp = await pipeline.clone().webp({ quality: 76, effort: 4 }).toBuffer();
        const avifName = `${base}.${hash(avif)}.${width}.avif`;
        const webpName = `${base}.${hash(webp)}.${width}.webp`;
        variants.avif.push({ width, url: await this.writeBuffer('media', avifName, avif) });
        variants.webp.push({ width, url: await this.writeBuffer('media', webpName, webp) });
      }

      return {
        src,
        width: metadata.width,
        height: metadata.height,
        avif: variants.avif.map(item => `${item.url} ${item.width}w`).join(', '),
        webp: variants.webp.map(item => `${item.url} ${item.width}w`).join(', ')
      };
    })();
    this.images.set(cacheKey, promise);
    return promise;
  }
}

function picture(image, options = {}) {
  const sizes = options.sizes || '100vw';
  const imageAttributes = attrs({
    src: image.src,
    alt: options.alt || '',
    class: options.className,
    width: image.width,
    height: image.height,
    loading: options.eager ? 'eager' : 'lazy',
    decoding: options.eager ? 'sync' : 'async',
    fetchpriority: options.eager ? 'high' : undefined,
    'data-lightbox-src': options.lightbox,
    ...options.extra
  });
  return `<picture>
    <source type="image/avif" srcset="${escapeHtml(image.avif)}" sizes="${escapeHtml(sizes)}">
    <source type="image/webp" srcset="${escapeHtml(image.webp)}" sizes="${escapeHtml(sizes)}">
    <img ${imageAttributes}>
  </picture>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = args.source || 'games.neon';
  const output = path.resolve(ROOT, args.output || 'dist');
  const environment = args.environment || 'production';
  if (!ENVIRONMENTS.has(environment)) throw new Error(`Unsupported environment: ${environment}`);

  let baseUrl;
  try {
    baseUrl = new URL(args['base-url'] || PRODUCTION_URL);
  } catch {
    throw new Error(`Invalid --base-url: ${args['base-url']}`);
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('--base-url must use HTTP or HTTPS');
  if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
  const pathPrefix = baseUrl.pathname;
  const now = args.now ? new Date(args.now) : new Date();
  if (Number.isNaN(now.valueOf())) throw new Error(`Invalid --now value: ${args.now}`);

  const games = readGames(source, ROOT).map(game => ({ ...game, isPast: isPastAt(game.dateObj, now) }));
  const upcoming = games.filter(game => !game.isPast).sort((a, b) => a.dateObj - b.dateObj);
  const past = games.filter(game => game.isPast).sort((a, b) => b.dateObj - a.dateObj);
  const siteContent = JSON.parse(await fs.readFile(path.join(ROOT, 'content', 'site.json'), 'utf8'));
  siteContent.discordUrl = safeExternalUrl(siteContent.discordUrl, 'site content: Discord URL');
  siteContent.mailingListUrl = safeExternalUrl(siteContent.mailingListUrl, 'site content: mailing list URL');
  siteContent.about.assemblyUrl = safeExternalUrl(siteContent.about.assemblyUrl, 'site content: assembly URL');

  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  const assets = new AssetBuilder(output, pathPrefix);
  const css = await fs.readFile(path.join(ROOT, 'styles', 'site.css'));
  const interactions = await fs.readFile(path.join(ROOT, 'scripts', 'interactions.js'));
  const cssUrl = await assets.writeBuffer('code', `site.${hash(css)}.css`, css);
  const scriptUrl = await assets.writeBuffer('code', `interactions.${hash(interactions)}.js`, interactions);
  const faviconUrl = await assets.file('favicon.ico', 'media', 'favicon');
  const logo = await assets.image('logos/RMG Logotype.png', [240, 480]);
  const discord = await assets.image('logos/discord.png', [32, 64]);
  const themeIcon = await assets.image('logos/theme.png', [24, 48]);
  const complexityIcon = await assets.image('logos/complexity.png', [24, 48]);
  const carousel = await Promise.all([1, 2, 3, 4].map(number => assets.image(`carousel/${number}.avif`, [640, 1100, 1600])));

  const routeUrl = route => `${pathPrefix}${route.replace(/^\//, '')}`.replace(/\/{2,}/g, '/');
  const absoluteUrl = route => new URL(routeUrl(route), baseUrl.origin).href;
  const canonicalUrl = route => new URL(route.replace(/^\//, ''), environment === 'staging' ? PRODUCTION_URL : baseUrl).href;
  const gameRoute = game => routeUrl(`games/${game.slug}/`);
  const paragraphs = values => values.map(value => `<p>${escapeHtml(value)}</p>`).join('\n');
  const ticketLink = game => game.tickets
    ? `<a class="ticket-btn" href="${escapeHtml(game.tickets)}" target="_blank" rel="noopener noreferrer">Tickets</a>`
    : '';
  const detailsLink = (game, label = 'Details') => `<a class="ticket-btn" href="${gameRoute(game)}">${label}</a>`;

  async function gameImage(game, kind, options = {}) {
    const sourcePath = kind === 'banner' ? game.bannerImage : game.listImage;
    const widths = kind === 'banner' ? [640, 1100, 1600] : [320, 640];
    const image = await assets.image(sourcePath, widths);
    return picture(image, {
      alt: game.name,
      className: options.className || (kind === 'banner' ? 'banner' : 'list-img'),
      sizes: options.sizes || (kind === 'banner' ? '(max-width: 1100px) 100vw, 1100px' : '(max-width: 600px) 100vw, 340px'),
      eager: options.eager,
      extra: options.extra
    });
  }

  function eventMeta(game) {
    const items = [];
    if (game.theme) items.push(`<span>${picture(themeIcon, { alt: '', sizes: '24px', className: 'meta-icon' })} ${escapeHtml(game.theme)}</span>`);
    if (game.complexity) items.push(`<span>${picture(complexityIcon, { alt: '', sizes: '24px', className: 'meta-icon' })} ${escapeHtml(game.complexity)}</span>`);
    return items.length ? `<p class="event-meta-icons">${items.join(' ')}</p>` : '';
  }

  async function pageLayout({ route, title, description, body, notFound = false }) {
    const robots = environment === 'staging' ? '<meta name="robots" content="noindex,nofollow">' : '';
    const fullTitle = title === 'Reading Megagames' ? title : `${title} | Reading Megagames`;
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  ${robots}
  <link rel="canonical" href="${escapeHtml(canonicalUrl(route))}">
  <meta property="og:title" content="${escapeHtml(fullTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(canonicalUrl(route))}">
  <link rel="icon" href="${faviconUrl}">
  <link rel="stylesheet" href="${cssUrl}">
  <script src="${scriptUrl}" defer></script>
</head>
<body${notFound ? ' class="not-found"' : ''}>
<header>
  <a class="site-logo" href="${routeUrl('')}">${picture(logo, { alt: 'Reading Megagames', sizes: '210px', eager: true })}</a>
  <nav aria-label="Primary navigation">
    <a href="${routeUrl('')}">Home</a>
    <a href="${routeUrl('upcoming/')}">Upcoming Games</a>
    <a href="${routeUrl('past/')}">Past Games</a>
    <a href="${routeUrl('about/')}">About Us</a>
  </nav>
</header>
<main class="container">${body}</main>
<dialog id="lightbox" class="lightbox" aria-label="Image preview">
  <button type="button" class="lightbox-close" data-lightbox-close aria-label="Close image preview">&times;</button>
  <img alt="">
</dialog>
<footer>&copy; John K 2026 &bull; Contact: <a href="mailto:info@readingmegagames.com">info@readingmegagames.com</a> &bull; <a href="${routeUrl('about/')}#code-of-conduct">Code of Conduct</a></footer>
</body>
</html>\n`;
  }

  async function compactCard(game) {
    return `<article class="card compact-event">
      <div class="compact-event-actions">${detailsLink(game)} ${ticketLink(game)}</div>
      <div class="compact-event-details"><strong><a href="${gameRoute(game)}">${escapeHtml(game.name)}</a></strong> (${escapeHtml(game.date)}, ${escapeHtml(game.location || '')})<p>${escapeHtml(game.tagline || '')}</p></div>
      <a href="${gameRoute(game)}">${await gameImage(game, 'list', { className: 'compact-event-image', sizes: '(max-width: 600px) 100vw, 130px' })}</a>
    </article>`;
  }

  async function listingCard(game, isUpcoming) {
    return `<article class="card">
      <a href="${gameRoute(game)}">${await gameImage(game, 'list')}</a>
      <h2><a href="${gameRoute(game)}">${escapeHtml(game.name)}</a></h2>
      <p>${escapeHtml(game.date)}</p>
      ${isUpcoming ? `<p>${escapeHtml(game.venue || '')}</p>${eventMeta(game)}` : ''}
      <p>${escapeHtml(game.tagline || '')}</p>
      ${detailsLink(game, isUpcoming ? 'Details' : 'View')} ${isUpcoming ? ticketLink(game) : ''}
    </article>`;
  }

  const carouselData = encodeURIComponent(JSON.stringify(carousel.map(image => ({
    src: image.src, avif: image.avif, webp: image.webp, width: image.width, height: image.height
  }))));
  const carouselHtml = `<div class="carousel" data-carousel="${escapeHtml(carouselData)}">
    ${picture(carousel[0], { alt: '', className: 'carousel-img', sizes: '(max-width: 900px) 100vw, 730px', eager: true })}
    <button class="prev" type="button" data-carousel-step="-1" aria-label="Previous carousel image">&lsaquo;</button>
    <button class="next" type="button" data-carousel-step="1" aria-label="Next carousel image">&rsaquo;</button>
  </div>`;

  const next = upcoming[0];
  const homeBody = `<h1>Welcome to Reading Megagames</h1>
  <div class="home-grid">
    <section>
      ${carouselHtml}
      ${next ? `<article class="highlight">
        <h2><a href="${gameRoute(next)}">Next Event: ${escapeHtml(next.name)}</a></h2>
        <a href="${gameRoute(next)}">${await gameImage(next, 'banner')}</a>
        <p>${escapeHtml(next.date)}</p><p>${escapeHtml(next.venue || '')}</p>
        ${eventMeta(next)}<p>${escapeHtml(next.tagline || '')}</p>
        ${detailsLink(next)} ${ticketLink(next)}
      </article>` : '<p>There are no upcoming games currently announced.</p>'}
      <div class="compact-events">${(await Promise.all(upcoming.slice(1).map(compactCard))).join('\n')}</div>
    </section>
    <aside class="sidebar">
      <div class="home-intro">${paragraphs(siteContent.homeIntro)}</div>
      <div class="cta-box"><h2>Join Our Community</h2><p><a class="community-link" href="${escapeHtml(siteContent.discordUrl)}" target="_blank" rel="noopener noreferrer">${picture(discord, { alt: '', sizes: '32px', className: 'community-icon' })} Discord Server</a></p></div>
      <div class="mailing-list-placeholder"><h2>Mailing List</h2><p>Hear when new games are announced.</p><p><button class="ticket-btn" type="button" data-mailing-src="${escapeHtml(siteContent.mailingListUrl)}">Load signup form</button></p></div>
    </aside>
  </div>`;

  const pages = [];
  pages.push(['index.html', await pageLayout({
    route: '', title: 'Reading Megagames',
    description: 'Large-scale games combining board gaming, roleplay, negotiation, and grand strategy in Reading and Oxford.',
    body: homeBody
  })]);

  const upcomingCards = (await Promise.all(upcoming.map(game => listingCard(game, true)))).join('\n');
  pages.push(['upcoming/index.html', await pageLayout({
    route: 'upcoming/', title: 'Upcoming Games', description: 'Upcoming megagames from Reading Megagames.',
    body: `<h1>Upcoming Games</h1><div class="games-grid">${upcomingCards || '<p>No games are currently announced.</p>'}</div>`
  })]);

  const pastCards = (await Promise.all(past.map(game => listingCard(game, false)))).join('\n');
  pages.push(['past/index.html', await pageLayout({
    route: 'past/', title: 'Past Games', description: 'Past Reading Megagames events and photo galleries.',
    body: `<h1>Past Games</h1><div class="games-grid long-list">${pastCards || '<p>No past games are available.</p>'}</div>`
  })]);

  const { about, conduct } = siteContent;
  const aboutBody = `<h1>${escapeHtml(about.heading)}</h1>
    ${paragraphs([about.paragraphs[0]])}<p><em>${escapeHtml(about.ageNotice)}</em></p>${paragraphs(about.paragraphs.slice(1))}
    <p>For information on megagames from other groups, visit <a href="${escapeHtml(about.assemblyUrl)}">${escapeHtml(about.assemblyLabel)}</a>.</p>
    <h2 id="code-of-conduct">${escapeHtml(conduct.heading)}</h2>
    <p>${escapeHtml(conduct.intro)}</p><p>${escapeHtml(conduct.leadIn)}</p>
    <ul>${conduct.rules.map(rule => `<li>${escapeHtml(rule)}</li>`).join('')}</ul>
    <p>${escapeHtml(conduct.note)}</p><p>${escapeHtml(conduct.closing)}</p>`;
  pages.push(['about/index.html', await pageLayout({
    route: 'about/', title: 'About Us', description: 'About Reading Megagames and our code of conduct.', body: aboutBody
  })]);

  for (const game of games) {
    const gallery = game.isPast && game.photos.length
      ? `<h2>Photos</h2><div class="gallery">${(await Promise.all(game.photos.map(async name => {
          const image = await assets.image(`photos/${game.slug}/${name}`, [320, 640, 960]);
          return picture(image, { alt: '', sizes: '(max-width: 600px) 50vw, 320px', lightbox: image.src });
        }))).join('\n')}</div>`
      : '';
    const body = `<article class="game-detail">
      <h1>${escapeHtml(game.name)}</h1>
      ${await gameImage(game, 'banner', { eager: true })}
      <p><strong>Date:</strong> ${escapeHtml(game.date)}</p>
      <p><strong>Venue:</strong> ${escapeHtml(game.venue || '')}</p>
      ${game.isPast ? '' : ticketLink(game)}
      <div class="markdown">${markdownToHtml(game.description)}</div>
      ${gallery}
    </article>`;
    pages.push([`games/${game.slug}/index.html`, await pageLayout({
      route: `games/${game.slug}/`, title: game.name,
      description: game.tagline || `${game.name}, a Reading Megagames event.`, body
    })]);
  }

  pages.push(['404.html', await pageLayout({
    route: '404.html', title: 'Page not found', description: 'The requested page could not be found.',
    body: `<h1>Page not found</h1><p>The page you requested does not exist. <a href="${routeUrl('')}">Return home</a>.</p>`, notFound: true
  })]);

  for (const [filename, content] of pages) {
    const target = path.join(output, filename);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }

  const sitemapRoutes = ['', 'upcoming/', 'past/', 'about/', ...games.map(game => `games/${game.slug}/`)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapRoutes.map(route => `  <url><loc>${escapeHtml(new URL(route, PRODUCTION_URL).href)}</loc></url>`).join('\n')}\n</urlset>\n`;
  await fs.writeFile(path.join(output, 'sitemap.xml'), sitemap);
  await fs.writeFile(path.join(output, 'robots.txt'), environment === 'staging'
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nSitemap: ${PRODUCTION_URL}sitemap.xml\n`);
  if (environment === 'staging') await fs.writeFile(path.join(output, 'CNAME'), 'test.readingmegagames.co.uk\n');

  const securityHeaders = [
    'X-Content-Type-Options: nosniff',
    'Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy: camera=(), geolocation=(), microphone=()',
    `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-src https://www-readingmegagames-com.filesusr.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`
  ];
  const headers = `/*\n${securityHeaders.map(value => `  ${value}`).join('\n')}\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/\n  Cache-Control: public, max-age=0, s-maxage=300, must-revalidate, stale-while-revalidate=86400\n\n/upcoming/*\n  Cache-Control: public, max-age=0, s-maxage=300, must-revalidate, stale-while-revalidate=86400\n\n/past/*\n  Cache-Control: public, max-age=0, s-maxage=300, must-revalidate, stale-while-revalidate=86400\n\n/about/*\n  Cache-Control: public, max-age=0, s-maxage=300, must-revalidate, stale-while-revalidate=86400\n\n/games/*\n  Cache-Control: public, max-age=0, s-maxage=300, must-revalidate, stale-while-revalidate=86400\n`;
  await fs.writeFile(path.join(output, '_headers'), headers);
  await fs.writeFile(path.join(output, '_redirects'), '/home / 301\n/game/:slug /games/:slug/ 301\n');
  await fs.writeFile(path.join(output, '.nojekyll'), '');

  const files = [];
  async function collect(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(absolute);
      else if (entry.name !== 'build-manifest.json') files.push(absolute);
    }
  }
  await collect(output);
  files.sort();
  const contentHasher = crypto.createHash('sha256');
  for (const file of files) {
    contentHasher.update(path.relative(output, file).replaceAll('\\', '/'));
    contentHasher.update(await fs.readFile(file));
  }
  const sourceBuffer = await fs.readFile(path.resolve(ROOT, source));
  const manifest = {
    contentHash: contentHasher.digest('hex'),
    sourceHash: crypto.createHash('sha256').update(sourceBuffer).digest('hex'),
    classification: `${utcDateKey(now)}-${now.getUTCHours() >= 16 ? 'after-1600' : 'before-1600'}`,
    environment,
    gameCount: games.length
  };
  await fs.writeFile(path.join(output, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built ${games.length} games and ${pages.length} HTML pages in ${output}`);
  console.log(`Content hash: ${manifest.contentHash}`);
}

main().catch(error => {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
});
