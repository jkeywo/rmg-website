import { createGamesLoader, createRenderGate, gamesSource, routeFromHash } from './games.js';
import { sizeGallery } from './gallery.js';
import { notFound, renderAbout, renderGame, renderHome, renderListing } from './views.js';

const app = document.getElementById('app');
const dialog = document.getElementById('lightbox');
const loadGames = createGamesLoader();
const beginRender = createRenderGate();
let contentPromise;
let carouselIndex = 0;
let carouselPaused = matchMedia('(prefers-reduced-motion: reduce)').matches;
const galleryObserver = new ResizeObserver(entries => entries.forEach(entry => sizeGallery(entry.target)));

function loadContent() {
  if (!contentPromise) {
    contentPromise = fetch('content/site.json', { cache: 'no-cache' }).then(response => {
      if (!response.ok) throw new Error(`Site content request failed (${response.status})`);
      return response.json();
    }).catch(error => { contentPromise = undefined; throw error; });
  }
  return contentPromise;
}

async function render(moveFocus = false) {
  const isCurrent = beginRender();
  const route = routeFromHash(location.hash);
  if (dialog.open) dialog.close();
  // Keep the current page (and its height) until the replacement is ready.
  // The HTML shell already supplies the loading state for the initial visit.
  app.setAttribute('aria-busy', 'true');
  try {
    let html;
    let title;
    if (route.page === 'not-found') {
      html = notFound;
      title = 'Page not found';
    } else if (route.page === 'about') {
      html = renderAbout(await loadContent());
      title = 'About Us';
    } else {
      const [games, content] = await Promise.all([
        loadGames(gamesSource(location.search)),
        route.page === 'home' ? loadContent() : Promise.resolve(null)
      ]);
      if (!isCurrent()) return;
      const upcoming = games.filter(game => !game.isPast).sort((a, b) => a.dateObj - b.dateObj);
      const past = games.filter(game => game.isPast).sort((a, b) => b.dateObj - a.dateObj);
      if (route.page === 'home') html = renderHome(upcoming, content, carouselIndex, carouselPaused);
      if (route.page === 'upcoming' || route.page === 'past') {
        html = renderListing(route.page === 'upcoming' ? upcoming : past, route.page === 'upcoming');
        title = route.page === 'upcoming' ? 'Upcoming Games' : 'Past Games';
      }
      if (route.page === 'game') {
        const game = games.find(game => game.slug === route.slug);
        html = game ? renderGame(game) : notFound;
        title = game ? game.name : 'Game not found';
      }
    }
    if (!isCurrent()) return;
    galleryObserver.disconnect();
    app.innerHTML = html;
    document.title = title ? `${title} | Reading Megagames` : 'Reading Megagames';
    document.querySelectorAll('nav a').forEach(link => {
      if (link.hash === `#${route.page}`) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    app.querySelectorAll('.gallery').forEach(gallery => { sizeGallery(gallery); galleryObserver.observe(gallery); });
    if (moveFocus) { window.scrollTo(0, 0); app.focus({ preventScroll: true }); }
    if (route.conduct) {
      const heading = document.getElementById('code-of-conduct');
      heading.scrollIntoView();
      heading.focus({ preventScroll: true });
    }
  } catch (error) {
    if (!isCurrent()) return;
    console.error(error);
    galleryObserver.disconnect();
    document.title = 'Content unavailable | Reading Megagames';
    app.innerHTML = '<h1>Content could not be loaded</h1><p>Please try again, or <a href="mailto:info@readingmegagames.com">contact Reading Megagames</a>.</p><button type="button" data-retry>Try again</button> <a href="#about">About us</a>';
  } finally {
    if (isCurrent()) app.removeAttribute('aria-busy');
  }
}

function moveCarousel(step) {
  carouselIndex = (carouselIndex + step + 4) % 4;
  const image = document.getElementById('carousel-img');
  if (image) image.src = `carousel/${carouselIndex + 1}.avif`;
}

window.addEventListener('hashchange', () => render(true));
document.addEventListener('click', event => {
  // Leave new-tab/window/download actions to the browser.
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const target = event.target;
  if (target.closest('[data-retry]')) { render(true); return; }
  const step = target.closest('[data-carousel-step]');
  if (step) { moveCarousel(Number(step.dataset.carouselStep)); return; }
  const pause = target.closest('[data-carousel-pause]');
  if (pause) {
    carouselPaused = !carouselPaused;
    pause.textContent = carouselPaused ? 'Play slideshow' : 'Pause slideshow';
    return;
  }
  const photo = target.closest('[data-lightbox-src]');
  if (photo) {
    event.preventDefault();
    const image = dialog.querySelector('img');
    image.src = photo.dataset.lightboxSrc;
    image.alt = photo.querySelector('img').alt;
    dialog.showModal();
    return;
  }
  if (target.closest('[data-lightbox-close]') || target === dialog) { dialog.close(); return; }
  const link = target.closest('a[href^="#"]');
  if (link && link.hash === location.hash) { event.preventDefault(); render(true); }
});
document.addEventListener('load', event => {
  if (event.target.matches?.('.gallery img')) sizeGallery(event.target.closest('.gallery'));
}, true);
document.addEventListener('error', event => {
  if (event.target.matches?.('.gallery img')) {
    const photo = event.target;
    const link = photo.closest('a');
    link.classList.add('photo-unavailable');
    link.textContent = `${photo.alt} — image unavailable`;
    link.removeAttribute('data-lightbox-src');
    sizeGallery(link.closest('.gallery'));
  }
}, true);
setInterval(() => {
  if (!carouselPaused && !document.hidden && document.getElementById('carousel-img')) moveCarousel(1);
}, 10000);
render();
