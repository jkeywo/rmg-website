/* -------- MARKDOWN -------- */
function md(text) {
  if (!text) return '';
  return text
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
    const src = `photos/${slug}/${name}`;
    html += `<img src="${src}" loading="lazy" data-lightbox-src="${src}">`;
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
      <img id="carousel-img" src="${carouselImages[0]}">
      <button class="prev" type="button" data-carousel-step="-1">&lsaquo;</button>
      <button class="next" type="button" data-carousel-step="1">&rsaquo;</button>
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
    const slug = hash.split('/')[1];
    const g = games.find(x => x.slug === slug);

    app.innerHTML = `
      <h1>${g.name}</h1>
      ${g.bannerImage ? `<img class="banner" src="${g.bannerImage}">` : ''}
      <p><strong>Date:</strong> ${g.date}</p>
      <p><strong>Venue:</strong> ${g.venue}</p>
      ${!g.isPast && g.tickets ? `<a class="ticket-btn" href="${g.tickets}" target="_blank">Tickets</a>` : ''}
      <div class="markdown">${md(g.description)}</div>
      ${g.isPast ? `${buildGalleryHTML(g.slug, g.photoList)}` : ''}
    `;
    return;
  }

  if (hash === 'home') {
    const next = upcoming[0];

    var innerHTML = `
      <h1>Welcome to Reading Megagames</h1>

      <div class="home-grid">

        <div>
          ${carouselHTML()}

          ${next ? `
            <div class="highlight">
              <h2 data-route="game/${next.slug}">Next Event: ${next.name}</h2>
              ${next.bannerImage ? `<img class="list-img" src="${next.bannerImage}" data-route="game/${next.slug}">` : ''}
              <p>${next.date}</p><p>${next.venue || ''}</p>
              ${next.theme || next.complexity ? `<p>
                ${next.theme ? `<img height="24px" src="logos/theme.png" /> ${next.theme}` : ''} 
                ${next.complexity ? `<img height="24px" src="logos/complexity.png" /> ${next.complexity}` : ''}
              </p>` : ''}
              <p>${next.tagline || ''}</p>
              <a href="#game/${next.slug}" data-route="game/${next.slug}" class="ticket-btn">Details</a>
              <a class="ticket-btn" href="${next.tickets}" target="_blank">Tickets</a>
            </div>` : ''}`;

    skip = true;
    upcoming.forEach(g => {
      if (skip) {
        skip = false;
      } else {
        innerHTML += `<div class="card">
                            <table width="100%"><tr>
                              <td style="padding:4px">
                                <a href="#game/${g.slug}" data-route="game/${g.slug}" class="ticket-btn">Details</a>
                                <a class="ticket-btn" href="${g.tickets}" target="_blank">Tickets</a>
                              </td>
                              <td style="padding:4px" data-route="game/${g.slug}">
                                <strong>${g.name}</strong> (${g.date}, ${g.location})
                                <br />${g.tagline || ''}
                              </td>
                              <td style="padding:4px" data-route="game/${g.slug}">
                                ${g.listImage ? `<img class="list-img" style="height: 70px;" src="${g.listImage}">` : ''}
                              </td>
                            </tr></table>
                          </div>`;
      }
    });
    innerHTML +=
        `</div>

        <div class="sidebar">
            <div style="font-size:large">
                <p>Megagames are an exciting hybrid of board gaming, roleplay, LARP, and Model UN. With player counts ranging from 25-100, usually played in loose teams with both co-operative and competitive elements.</p>
                <p>Diplomacy or treachery, grand strategy or opportunism. What story will you tell?</p>
            </div>
          <div class="cta-box">
            <h2>Join Our Community</h2>
            <p><a href="https://discord.gg/3UD7cRbv37" target="_blank"><img src="logos/discord.png" height="32px" />Discord Server</a></p>
          </div>

          <div>
            <iframe frameBorder="0" class="Z8YsjS" title="Mailing Lst" name="htmlComp-iframe" width="100%" height="275px" allow="fullscreen" data-src="" src="https://www-readingmegagames-com.filesusr.com/html/9e54e1_9eef650b3ae8b6075994be8d68a72835.html"></iframe>
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
        <p>To that end:
        <ul><li>It will always be our highest priority to ensure that the megagames we run are safe environments for the players and the facilitator team.</li>
        <li>All forms of discrimination, including sexism, racism, homophobia and transphobia, are unacceptable at games run by Reading Megagames, and may result in expulsion from the game without further discussion.</li>
        <li>Any harassment or abuse of players or facilitators is likewise unacceptable and may also result in expulsion from the game without further discussion.</li>
        <li>Players at one of our games experiencing discriminatory or abusive behaviour are encouraged to report it immediately to the facilitator team for the game, who will treat it with the utmost seriousness.</li>
        </ul></p>
        <p>Note: we are aware that megagames include elements of roleplaying, and that good-faith attempts to roleplay aggressive or demanding characters may nevertheless be upsetting to others. Where appropriate, we will discuss these situations with players, and provided they are willing to change their behaviour accordingly, no further action will be taken.</p>
        <p>We understand that there is always room for improvement in the area of diversity and inclusion, and we welcome feedback on this code of conduct or any other aspect of how we manage our games and community.</p>`;
  }

  if (hash === 'upcoming') {
    app.innerHTML = '<h1>Upcoming Games</h1><div class="games-grid"></div>';
    const grid = app.querySelector('.games-grid');

    upcoming.forEach(g => {
      grid.innerHTML += `
        <div class="card">
          ${g.listImage ? `<img class="list-img" src="${g.listImage}" data-route="game/${g.slug}">` : ''}
          <h2 data-route="game/${g.slug}">${g.name}</h2>
          <p>${g.date}</p><p>${g.venue || ''}</p>
          ${g.theme || g.complexity ? `<p>${g.theme ? `<img height="24px" src="logos/theme.png" /> ${g.theme}` : ''} ${g.complexity ? `<img height="24px" src="logos/complexity.png" /> ${g.complexity}` : ''}</p>` : ''}
          <p>${g.tagline || ''}</p>
          <a href="#game/${g.slug}" data-route="game/${g.slug}" class="ticket-btn">Details</a>
          <a class="ticket-btn" href="${g.tickets}" target="_blank">Tickets</a>
        </div>`;
    });
  }

  if (hash === 'past') {
    app.innerHTML = '<h1>Past Games</h1><div class="games-grid"></div>';
    const grid = app.querySelector('.games-grid');

    past.forEach(g => {
      grid.innerHTML += `
        <div class="card">
          ${g.listImage ? `<img class="list-img" src="${g.listImage}" data-route="game/${g.slug}">` : ''}
          <h2 data-route="game/${g.slug}">${g.name}</h2>
          <p>${g.date}</p>
          <p>${g.tagline || ''}</p>
          <a href="#game/${g.slug}" data-route="game/${g.slug}" class="ticket-btn">View</a>
        </div>`;
    });
  }
}

render();
