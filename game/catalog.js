export { CHARACTERS } from '../vendor/discovery.js';

export const WORLDS = {
  wildwood: { name: 'Wildwood', sky: 0xf6e7bb, sun: 0xfff5ce, distant: 0xd0cda2,
    leaves: 0xa9b88b, tree: 0x788f67, ground: 0x536d50, branch: 0x334b36, bark: 0x61794e,
    trail: 0xfff9db },
  amberwood: { name: 'Amberwood', sky: 0xc6655f, sun: 0xffd38d, distant: 0xb25b56,
    leaves: 0x91484e, tree: 0x693747, ground: 0x432736, branch: 0x26202d, bark: 0x614043,
    trail: 0xfff2c9 },
  inkwild: { name: 'Inkwild', sky: 0xeee1cb, sun: 0xfff6e0, distant: 0xc4c6b3,
    leaves: 0x9ba99c, tree: 0x667e73, ground: 0x405a51, branch: 0x171f1c, bark: 0x45534a,
    trail: 0xf6ecd8 },
};

export const validWorld = value => Object.hasOwn(WORLDS, value) ? value : 'wildwood';
