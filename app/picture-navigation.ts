export type PicturePoint = { x: number; y: number };
export const PICTURE_PAN_THRESHOLD = 3;

function finiteOrZero(value: number) {
  return Number.isFinite(value) ? value : 0;
}

export function shouldStartPicturePan(deltaX: number, deltaY: number) {
  return Math.hypot(finiteOrZero(deltaX), finiteOrZero(deltaY)) > PICTURE_PAN_THRESHOLD;
}

export function clampPicturePan(viewportWidth: number, viewportHeight: number, contentWidth: number, contentHeight: number, zoomValue: number, pan: PicturePoint): PicturePoint {
  const zoom = Math.min(8, Math.max(.5, finiteOrZero(zoomValue) || 1));
  const maximumX = Math.max(0, (Math.max(0, finiteOrZero(contentWidth)) * zoom - Math.max(0, finiteOrZero(viewportWidth))) / 2);
  const maximumY = Math.max(0, (Math.max(0, finiteOrZero(contentHeight)) * zoom - Math.max(0, finiteOrZero(viewportHeight))) / 2);
  return {
    x: Math.min(maximumX, Math.max(-maximumX, finiteOrZero(pan.x))),
    y: Math.min(maximumY, Math.max(-maximumY, finiteOrZero(pan.y))),
  };
}

export function zoomAroundPoint(currentZoom: number, nextZoomValue: number, pan: PicturePoint, anchor: PicturePoint) {
  const safeCurrent = Math.min(8, Math.max(.5, finiteOrZero(currentZoom) || 1));
  const nextZoom = Math.min(8, Math.max(.5, finiteOrZero(nextZoomValue) || 1));
  const ratio = nextZoom / safeCurrent;
  return {
    zoom: nextZoom,
    pan: {
      x: finiteOrZero(anchor.x) - (finiteOrZero(anchor.x) - finiteOrZero(pan.x)) * ratio,
      y: finiteOrZero(anchor.y) - (finiteOrZero(anchor.y) - finiteOrZero(pan.y)) * ratio,
    },
  };
}

export function navigationViewport(viewportWidth: number, viewportHeight: number, contentWidth: number, contentHeight: number, zoomValue: number, pan: PicturePoint) {
  const zoom = Math.min(8, Math.max(.5, finiteOrZero(zoomValue) || 1));
  const scaledWidth = Math.max(1, finiteOrZero(contentWidth) * zoom);
  const scaledHeight = Math.max(1, finiteOrZero(contentHeight) * zoom);
  const width = Math.min(1, Math.max(0, finiteOrZero(viewportWidth)) / scaledWidth);
  const height = Math.min(1, Math.max(0, finiteOrZero(viewportHeight)) / scaledHeight);
  const left = Math.min(1 - width, Math.max(0, .5 - finiteOrZero(pan.x) / scaledWidth - width / 2));
  const top = Math.min(1 - height, Math.max(0, .5 - finiteOrZero(pan.y) / scaledHeight - height / 2));
  return { left, top, width, height };
}
