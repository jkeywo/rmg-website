(() => {
  const legacyRoutes = new Map([
    ['home', '/'],
    ['upcoming', '/upcoming/'],
    ['past', '/past/'],
    ['about', '/about/']
  ]);

  const legacyHash = location.hash.slice(1);
  if (legacyHash.startsWith('game/')) {
    location.replace(`/games/${encodeURIComponent(decodeURIComponent(legacyHash.slice(5)))}/`);
    return;
  }
  if (legacyRoutes.has(legacyHash)) {
    location.replace(legacyRoutes.get(legacyHash));
    return;
  }

  const carousel = document.querySelector('[data-carousel]');
  let carouselImages = [];
  let carouselIndex = 0;
  if (carousel) {
    try {
      carouselImages = JSON.parse(decodeURIComponent(carousel.dataset.carousel));
    } catch {
      carouselImages = [];
    }
  }

  function showCarouselImage(index) {
    if (!carouselImages.length) return;
    carouselIndex = (index + carouselImages.length) % carouselImages.length;
    const image = carouselImages[carouselIndex];
    const picture = carousel.querySelector('picture');
    const sources = picture.querySelectorAll('source');
    if (sources[0]) sources[0].srcset = image.avif;
    if (sources[1]) sources[1].srcset = image.webp;
    const element = picture.querySelector('img');
    element.src = image.src;
    element.width = image.width;
    element.height = image.height;
  }

  document.addEventListener('click', event => {
    const carouselButton = event.target.closest('[data-carousel-step]');
    if (carouselButton) {
      showCarouselImage(carouselIndex + Number(carouselButton.dataset.carouselStep));
      return;
    }

    const lightboxImage = event.target.closest('[data-lightbox-src]');
    if (lightboxImage) {
      const dialog = document.getElementById('lightbox');
      dialog.querySelector('img').src = lightboxImage.dataset.lightboxSrc;
      dialog.showModal();
      return;
    }

    if (event.target.closest('[data-lightbox-close]')) {
      document.getElementById('lightbox').close();
      return;
    }
  });

  document.getElementById('lightbox')?.addEventListener('click', event => {
    if (event.target.nodeName === 'DIALOG') event.currentTarget.close();
  });

  if (carouselImages.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setInterval(() => {
      if (!document.hidden && carousel.isConnected) showCarouselImage(carouselIndex + 1);
    }, 10000);
  }
})();
