// Oxford's equal-area sizing: every photo retains its natural aspect ratio.
export function galleryPhotoSizes(width, columns, gap, ratios) {
  if (width <= 0 || columns <= 0 || ratios.some(ratio => !Number.isFinite(ratio) || ratio <= 0)) return [];
  const unit = Math.max(0, (width - gap * (columns - 1)) / columns);
  const area = Math.min(unit * unit, width * width / Math.max(1, ...ratios));
  return ratios.map(ratio => ({ width: Math.sqrt(area * ratio), height: Math.sqrt(area / ratio) }));
}

export function sizeGallery(gallery) {
  const photos = [...gallery.querySelectorAll('img')].filter(photo => photo.naturalWidth && photo.naturalHeight);
  const style = getComputedStyle(gallery);
  const sizes = galleryPhotoSizes(gallery.clientWidth, Number(style.getPropertyValue('--gallery-columns')), parseFloat(style.columnGap) || 0, photos.map(photo => photo.naturalWidth / photo.naturalHeight));
  photos.forEach((photo, index) => {
    if (!sizes[index]) return;
    const link = photo.closest('a');
    link.style.width = `${sizes[index].width}px`;
    link.style.height = `${sizes[index].height}px`;
  });
}
