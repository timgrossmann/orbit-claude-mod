// Compact silhouettes shared by terminal and Desktop. Avoid thin ornaments
// that vanish between samples as the character moves across the terminal grid.
const SIZE = 24, sprites = new Map();
export function sprite(character) {
  if (sprites.has(character)) return sprites.get(character);
  const pixels = new Uint8Array(SIZE * SIZE);
  const dot = (x, y, c = 1) => { if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) pixels[y * SIZE + x] = c; };
  const rect = (x, y, w, h, c = 1) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) dot(xx, yy, c); };
  rect(8, 7, 9, 2); rect(6, 9, 13, 8);
  rect(9, 11, 2, 3, 2); rect(14, 11, 2, 3, 2);
  const scarf = { x: 8, y: 17, width: 9, height: 2 };
  rect(scarf.x, scarf.y, scarf.width, scarf.height, 3);
  const result = { pixels, width: SIZE, height: SIZE, anchorX: 12.5, anchorY: 13.5, scarf };
  sprites.set(character, result); return result;
}
