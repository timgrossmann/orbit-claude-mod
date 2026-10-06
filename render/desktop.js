import { pixelFrame } from './pixels.js';

export function desktopFrame(game) {
  const { width, height, pixels } = pixelFrame(game), paths = new Map();
  for (let y = 0; y < height; y++) for (let x = 0; x < width;) {
    const color = pixels[y * width + x]; let end = x + 1;
    while (end < width && pixels[y * width + end] === color) end++;
    paths.set(color, (paths.get(color) || '') + `M${x} ${y}h${end - x}v1H${x}z`); x = end;
  }
  const shapes = [...paths].map(([color, d]) => `<path fill="#${color.toString(16).padStart(6, '0')}" d="${d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges"><title>ORBIT</title>${shapes}</svg>`;
}
