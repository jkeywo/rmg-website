const script = document.querySelector('script[data-legacy-route]');
const destination = new URL(script.dataset.root, location.href);
destination.search = location.search;
destination.hash = script.dataset.legacyRoute === 'about' && location.hash === '#code-of-conduct'
  ? 'about/code-of-conduct' : script.dataset.legacyRoute;
location.replace(destination.href);
