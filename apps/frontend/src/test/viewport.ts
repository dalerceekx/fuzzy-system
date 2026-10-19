/** Emulated viewport width for the jsdom matchMedia polyfill (desktop by default). */
let viewportWidth = 1280;

export function setViewportWidth(width: number): void {
  viewportWidth = width;
}

export function getViewportWidth(): number {
  return viewportWidth;
}
