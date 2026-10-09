import { escapeHtml as esc, markdownToHtml, safeExternalUrl } from './site-lib.js';

const paragraphs = values => values.map(value => `<p>${esc(value)}</p>`).join('');
const route = game => `#game/${game.slug}`;
const imagePath = value => value.split('/').map(encodeURIComponent).join('/');
const details = (game, label = 'Details') => `<a class="ticket-btn" href="${route(game)}">${label}</a>`;
const tickets = game => !game.isPast && game.tickets ? `<a class="ticket-btn" href="${esc(game.tickets)}" target="_blank" rel="noopener noreferrer">Tickets</a>` : '';
const image = (game, field, className, eager = false) => `<img class="${className}" src="${esc(imagePath(game[field]))}" alt="${esc(game.name)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async">`;
const meta = game => `<p class="event-meta-icons">${['theme', 'complexity'].filter(key => game[key]).map(key => `<span><img src="logos/${key}.png" alt="" width="24" height="24"> ${esc(game[key])}</span>`).join('')}</p>`;

export function renderAbout(content) {
  const { about, conduct } = content;
  return `<h1>${esc(about.heading)}</h1>
    ${paragraphs([about.paragraphs[0]])}<p><em>${esc(about.ageNotice)}</em></p>${paragraphs(about.paragraphs.slice(1))}
    <p>For information on megagames from other groups, visit <a href="${esc(safeExternalUrl(about.assemblyUrl, 'Assembly URL'))}">${esc(about.assemblyLabel)}</a>.</p>
    <h2 id="code-of-conduct" tabindex="-1">${esc(conduct.heading)}</h2>
    <p>${esc(conduct.intro)}</p><p>${esc(conduct.leadIn)}</p>
    <ul>${conduct.rules.map(rule => `<li>${esc(rule)}</li>`).join('')}</ul>
    <p>${esc(conduct.note)}</p><p>${esc(conduct.closing)}</p>`;
}

export function renderGallery(game) {
  if (!game.isPast || !game.photos.length) return '';
  return `<h2>Photos</h2><div class="gallery">${game.photos.map((name, index) => {
    const src = esc(imagePath(`photos/${game.slug}/${name}`));
    return `<a href="${src}" data-lightbox-src="${src}" aria-label="Open photo ${index + 1} of ${esc(game.name)}"><img src="${src}" alt="${esc(game.name)} — photo ${index + 1}" loading="lazy" decoding="async"></a>`;
  }).join('')}</div>`;
}

export function renderGame(game) {
  return `<article class="game-detail"><h1>${esc(game.name)}</h1>
    ${image(game, 'bannerImage', 'banner', true)}
    <p><strong>Date:</strong> ${esc(game.date)}</p><p><strong>Venue:</strong> ${esc(game.venue)}</p>
    ${tickets(game)}<div class="markdown">${markdownToHtml(game.description)}</div>${renderGallery(game)}</article>`;
}

export function renderListing(games, upcoming) {
  return `<h1>${upcoming ? 'Upcoming' : 'Past'} Games</h1>
    ${games.length ? '' : `<p>${upcoming ? 'There are no upcoming games currently announced.' : 'No past games are available.'}</p>`}
    <div class="games-grid">${games.map(game => `<article class="card">
      <a href="${route(game)}">${image(game, 'listImage', 'list-img')}</a>
      <h2><a href="${route(game)}">${esc(game.name)}</a></h2><p>${esc(game.date)}</p>
      ${upcoming ? `<p>${esc(game.venue)}</p>${meta(game)}` : ''}
      <p>${esc(game.tagline)}</p>${details(game, upcoming ? 'Details' : 'View')} ${tickets(game)}</article>`).join('')}</div>`;
}

export function renderHome(upcoming, content, carouselIndex, paused) {
  const next = upcoming[0];
  return `<h1>Welcome to Reading Megagames</h1><div class="home-grid"><section>
    <div class="carousel" aria-label="Photos from our games">
      <img id="carousel-img" src="carousel/${carouselIndex + 1}.avif" alt="Photos from Reading Megagames" fetchpriority="high">
      <button class="prev" type="button" data-carousel-step="-1" aria-label="Previous carousel image">&lsaquo;</button>
      <button class="next" type="button" data-carousel-step="1" aria-label="Next carousel image">&rsaquo;</button>
    </div><button class="carousel-pause" type="button" data-carousel-pause>${paused ? 'Play slideshow' : 'Pause slideshow'}</button>
    ${next ? `<article class="highlight"><h2><a href="${route(next)}">Next Event: ${esc(next.name)}</a></h2>
      <a href="${route(next)}">${image(next, 'bannerImage', 'banner')}</a>
      <p>${esc(next.date)}</p><p>${esc(next.venue)}</p>${meta(next)}<p>${esc(next.tagline)}</p>${details(next)} ${tickets(next)}</article>` : '<p>There are no upcoming games currently announced.</p>'}
    <div class="compact-events">${upcoming.slice(1).map(game => `<article class="card compact-event">
      <div class="compact-event-actions">${details(game)} ${tickets(game)}</div>
      <div class="compact-event-details"><strong><a href="${route(game)}">${esc(game.name)}</a></strong> (${esc(game.date)}, ${esc(game.location)})<p>${esc(game.tagline)}</p></div>
      <a href="${route(game)}">${image(game, 'listImage', 'compact-event-image')}</a></article>`).join('')}</div></section>
    <aside class="sidebar"><div class="home-intro">${paragraphs(content.homeIntro)}</div>
      <div class="cta-box"><h2>Join Our Community</h2><p><a class="community-link" href="${esc(safeExternalUrl(content.discordUrl, 'Discord URL'))}" target="_blank" rel="noopener noreferrer"><img src="logos/discord.png" alt="" width="32" height="32" loading="lazy"> Discord Server</a></p></div>
      <div class="mailing-list-placeholder"><h2>Mailing List</h2><p>Hear when new games are announced.</p><iframe class="mailing-list-frame" title="Mailing list signup" loading="lazy" src="${esc(safeExternalUrl(content.mailingListUrl, 'Mailing list URL'))}"></iframe></div>
    </aside></div>`;
}

export const notFound = '<h1>Page not found</h1><p>The page you requested does not exist. <a href="#home">Return home</a>.</p>';
