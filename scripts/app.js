/* -------- HTML HELPERS -------- */
const htmlEscapes = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => htmlEscapes[character]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function pathSegment(value) {
  return encodeURIComponent(String(value ?? '')).replace(/%2F/gi, '');
}

function gameRoute(game) {
  return `game/${encodeURIComponent(game.slug || '')}`;
}

function routeAttrs(game) {
  const route = escapeAttr(gameRoute(game));
  return `href="#${route}" data-route="${route}"`;
}

function dataRouteAttr(game) {
  return `data-route="${escapeAttr(gameRoute(game))}"`;
}

function ticketsLink(game) {
  if (!game.tickets) return '';
  return `<a class="ticket-btn" href="${escapeAttr(game.tickets)}" target="_blank" rel="noopener noreferrer">Tickets</a>`;
}

function detailsLink(game, label = 'Details') {
  return `<a ${routeAttrs(game)} class="ticket-btn">${escapeHtml(label)}</a>`;
}

function gameImage(game, key, className, attrs = '') {
  if (!game[key]) return '';
  const extraAttrs = attrs ? ` ${attrs}` : '';
  return `<img class="${escapeAttr(className)}" src="${escapeAttr(game[key])}" alt="${escapeAttr(game.name || '')}" loading="lazy" decoding="async"${extraAttrs}>`;
}

function eventMetaHTML(game) {
  const meta = [];

  if (game.theme) {
    meta.push(`<span><img src="logos/theme.png" alt="" width="24" height="24" loading="lazy" decoding="async"> ${escapeHtml(game.theme)}</span>`);
  }

  if (game.complexity) {
    meta.push(`<span><img src="logos/complexity.png" alt="" width="24" height="24" loading="lazy" decoding="async"> ${escapeHtml(game.complexity)}</span>`);
  }

  return meta.length ? `<p class="event-meta-icons">${meta.join(' ')}</p>` : '';
}

/* -------- MARKDOWN -------- */
function md(text) {
  if (!text) return '';
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .split('\n\n')
    .map(p => `<p>${p}</p>`)
    .join('');
}

/* -------- NEON -------- */
function parseNeon(text) {
  const lines = text.split(/\r?\n/);
  const games = [];
  let current = null, key = null, buffer = [];

  function flush() {
    if (current && key) current[key] = buffer.join('\n').trim();
    buffer = [];
  }

  lines.forEach(line => {
    if (line.trim() === '-') {
      flush(); if (current) games.push(current);
      current = {}; key = null; return;
    }

    const m = line.match(/^([a-zA-Z0-9]+):\s*(.*)$/);
    if (m) {
      flush(); key = m[1];
      if (m[2] === '|') buffer = [];
      else { current[key] = m[2]; key = null; }
      return;
    }

    if (key) buffer.push(line);
  });

  flush(); if (current) games.push(current);
  return games;
}

/* -------- LOAD -------- */
const gamesBySource = new Map();

function getGamesSource() {
  const parser = new URL(window.location);
  return parser.searchParams.get('source') || 'games.neon';
}

function normalizeGame(game) {
  return {
    ...game,
    dateObj: new Date(game.date),
    photoList: game.photos
      ? game.photos
        .split(',')
        .map(p => p.trim())
        .filter(Boolean)
      : []
  };
}

async function loadGames() {
  const gamesSource = getGamesSource();

  if (!gamesBySource.has(gamesSource)) {
    const gamesPromise = fetch(gamesSource)
      .then(res => res.text())
      .then(text => parseNeon(text).map(normalizeGame))
      .catch(error => {
        gamesBySource.delete(gamesSource);
        throw error;
      });

    gamesBySource.set(gamesSource, gamesPromise);
  }

  const games = await gamesBySource.get(gamesSource);
  const now = new Date();

  games.forEach(g => {
    g.isPast = g.dateObj < now;
  });

  return games;
}

/* -------- PHOTO AUTO NUMBER -------- */
function buildGalleryHTML(slug, photoList) {
  if (photoList.length === 0) return '';

  let html = '<h2>Photos</h2><div class="gallery">';
  photoList.forEach(name => {
    const src = `photos/${pathSegment(slug)}/${pathSegment(name)}`;
    html += `<img src="${escapeAttr(src)}" alt="" loading="lazy" decoding="async" width="320" height="240" data-lightbox-src="${escapeAttr(src)}">`;
  });

  html += '</div>';
  return html;
}

/* -------- LIGHTBOX -------- */
function openLightbox(src) {
  const lb = document.getElementById('lightbox');
  document.getElementById('lightbox-img').src = src;
  lb.style.display = 'flex';
}

function closeLightbox() {
  document.getElementById('lightbox').style.display = 'none';
}

/* -------- CAROUSEL -------- */
const carouselImages = [
  'carousel/1.avif',
  'carousel/2.avif',
  'carousel/3.avif',
  'carousel/4.avif'
];

let carouselIndex = 0;

function carouselHTML() {
  return `
    <div class="carousel">
      <img id="carousel-img" src="${carouselImages[0]}" alt="" width="1100" height="320" fetchpriority="high">
      <button class="prev" type="button" data-carousel-step="-1" aria-label="Previous carousel image">&lsaquo;</button>
      <button class="next" type="button" data-carousel-step="1" aria-label="Next carousel image">&rsaquo;</button>
    </div>`;
}

function carouselMove(dir) {
  carouselIndex = (carouselIndex + dir + carouselImages.length) % carouselImages.length;
  document.getElementById('carousel-img').src = carouselImages[carouselIndex];
}

/* Auto-advance every 10 seconds */
setInterval(() => {
  if (document.getElementById('carousel-img')) {
    carouselMove(1);
  }
}, 10000);

/* -------- ROUTER -------- */
function navigate(p) {
  const nextHash = `#${p}`;

  if (location.hash === nextHash) {
    render();
  } else {
    location.hash = p;
  }
}

window.addEventListener('hashchange', render);

document.addEventListener('click', event => {
  const routeTarget = event.target.closest('[data-route]');
  if (routeTarget) {
    event.preventDefault();
    navigate(routeTarget.dataset.route);
    return;
  }

  const carouselTarget = event.target.closest('[data-carousel-step]');
  if (carouselTarget) {
    carouselMove(Number(carouselTarget.dataset.carouselStep));
    return;
  }

  const lightboxTarget = event.target.closest('[data-lightbox-src]');
  if (lightboxTarget) {
    openLightbox(lightboxTarget.dataset.lightboxSrc);
    return;
  }

  if (event.target.closest('[data-lightbox-close]')) {
    closeLightbox();
  }
});

/* -------- RENDER -------- */
async function render() {
  const app = document.getElementById('app');
  const hash = location.hash.replace('#', '') || 'home';
  const games = await loadGames();

  const upcoming = games.filter(g => !g.isPast).sort((a, b) => a.dateObj - b.dateObj);
  const past = games.filter(g => g.isPast).sort((a, b) => b.dateObj - a.dateObj);

  if (hash.startsWith('game/')) {
    const slug = decodeURIComponent(hash.split('/')[1] || '');
    const g = games.find(x => x.slug === slug);

    if (!g) {
      app.innerHTML = '<h1>Game not found</h1>';
      return;
    }

    app.innerHTML = `
      <h1>${escapeHtml(g.name)}</h1>
      ${gameImage(g, 'bannerImage', 'banner')}
      <p><strong>Date:</strong> ${escapeHtml(g.date)}</p>
      <p><strong>Venue:</strong> ${escapeHtml(g.venue)}</p>
      ${!g.isPast ? ticketsLink(g) : ''}
      <div class="markdown">${md(g.description)}</div>
      ${g.isPast ? `${buildGalleryHTML(g.slug, g.photoList)}` : ''}
    `;
    return;
  }

  if (hash === 'home') {
    const next = upcoming[0];

    let innerHTML = `
      <h1>Welcome to Reading Megagames</h1>

      <div class="home-grid">

        <div>
          ${carouselHTML()}

          ${next ? `
            <div class="highlight">
              <h2 ${dataRouteAttr(next)}>Next Event: ${escapeHtml(next.name)}</h2>
              ${gameImage(next, 'bannerImage', 'list-img', dataRouteAttr(next))}
              <p>${escapeHtml(next.date)}</p><p>${escapeHtml(next.venue || '')}</p>
              ${eventMetaHTML(next)}
              <p>${escapeHtml(next.tagline || '')}</p>
              ${detailsLink(next)}
              ${ticketsLink(next)}
            </div>` : ''}`;

    innerHTML += upcoming.slice(1).map(g => `
      <div class="card">
        <div class="compact-event">
          <div class="compact-event-actions">
            ${detailsLink(g)}
            ${ticketsLink(g)}
          </div>
          <div class="compact-event-details" ${dataRouteAttr(g)}>
            <strong>${escapeHtml(g.name)}</strong> (${escapeHtml(g.date)}, ${escapeHtml(g.location || '')})
            <p>${escapeHtml(g.tagline || '')}</p>
          </div>
          <div ${dataRouteAttr(g)}>
            ${gameImage(g, 'listImage', 'compact-event-image')}
          </div>
        </div>
      </div>
    `).join('');

    innerHTML +=
        `</div>

        <div class="sidebar">
            <div class="home-intro">
                <p>Megagames are an exciting hybrid of board gaming, roleplay, LARP, and Model UN. With player counts ranging from 25-100, usually played in loose teams with both co-operative and competitive elements.</p>
                <p>Diplomacy or treachery, grand strategy or opportunism. What story will you tell?</p>
            </div>
          <div class="cta-box">
            <h2>Join Our Community</h2>
            <p><a class="community-link" href="https://discord.gg/3UD7cRbv37" target="_blank" rel="noopener noreferrer"><img src="logos/discord.png" alt="" width="32" height="32" loading="lazy" decoding="async" />Discord Server</a></p>
          </div>

          <div>
            <iframe class="mailing-list-frame Z8YsjS" title="Mailing Lst" name="htmlComp-iframe" allow="fullscreen" data-src="" src="https://www-readingmegagames-com.filesusr.com/html/9e54e1_9eef650b3ae8b6075994be8d68a72835.html"></iframe>
          </div>
        </div>

      </div>
    `;
    app.innerHTML = innerHTML;
  }

  if (hash === 'about') {
    app.innerHTML = `
      <h1>About Us</h1>
        <p>Reading Megagames are a small group of local hobbyists who enjoy designing, running and playing megagames. We&rsquo;ve been active since 2018, running a mix of home-brewed and imported games.</p>
        <p><i>Due to the nature of the games we currently only run games for players aged 18 and over.</i></p>
        <p>We periodically run megagames in the Reading area - large-scale games combining elements of board gaming, roleplay, and negotiation. Expect us to run around four games a year - if there isn&rsquo;t one in the calendar right now, ask to be added to our mailing list and we&rsquo;ll let you know when the next one is organised.</p>
        <p>For information on megagames from other groups you can visit <a href="https://www.megagameassembly.com/">megagameassembly.com</a></p>
        <h1>Code of Conduct</h1>
        <p>Reading Megagames believes in promoting diversity and inclusion - it enables us to create a safe, fun and welcoming environment in our games, it&rsquo;s the best and healthiest way to help the megagame community grow, and it&rsquo;s just the right thing to do.</p>
        <p>To that end:</p>
        <ul><li>It will always be our highest priority to ensure that the megagames we run are safe environments for the players and the facilitator team.</li>
        <li>All forms of discrimination, including sexism, racism, homophobia and transphobia, are unacceptable at games run by Reading Megagames, and may result in expulsion from the game without further discussion.</li>
        <li>Any harassment or abuse of players or facilitators is likewise unacceptable and may also result in expulsion from the game without further discussion.</li>
        <li>Players at one of our games experiencing discriminatory or abusive behaviour are encouraged to report it immediately to the facilitator team for the game, who will treat it with the utmost seriousness.</li>
        </ul>
        <p>Note: we are aware that megagames include elements of roleplaying, and that good-faith attempts to roleplay aggressive or demanding characters may nevertheless be upsetting to others. Where appropriate, we will discuss these situations with players, and provided they are willing to change their behaviour accordingly, no further action will be taken.</p>
        <p>We understand that there is always room for improvement in the area of diversity and inclusion, and we welcome feedback on this code of conduct or any other aspect of how we manage our games and community.</p>`;
  }

  if (hash === 'upcoming') {
    app.innerHTML = '<h1>Upcoming Games</h1><div class="games-grid"></div>';
    const grid = app.querySelector('.games-grid');

    grid.innerHTML = upcoming.map(g => `
        <div class="card">
          ${gameImage(g, 'listImage', 'list-img', dataRouteAttr(g))}
          <h2 ${dataRouteAttr(g)}>${escapeHtml(g.name)}</h2>
          <p>${escapeHtml(g.date)}</p><p>${escapeHtml(g.venue || '')}</p>
          ${eventMetaHTML(g)}
          <p>${escapeHtml(g.tagline || '')}</p>
          ${detailsLink(g)}
          ${ticketsLink(g)}
        </div>
      `).join('');
  }

  if (hash === 'past') {
    app.innerHTML = '<h1>Past Games</h1><div class="games-grid"></div>';
    const grid = app.querySelector('.games-grid');

    grid.innerHTML = past.map(g => `
        <div class="card">
          ${gameImage(g, 'listImage', 'list-img', dataRouteAttr(g))}
          <h2 ${dataRouteAttr(g)}>${escapeHtml(g.name)}</h2>
          <p>${escapeHtml(g.date)}</p>
          <p>${escapeHtml(g.tagline || '')}</p>
          ${detailsLink(g, 'View')}
        </div>
      `).join('');
  }
}

render();
