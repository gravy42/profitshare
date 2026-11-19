// The sample film's pictures: ten original drawings of a motel, a road and a salt flat at dusk, made here by
// arithmetic as flat shapes in one small palette. Each is described once and comes out twice: as SVG (what the look
// book holds) and as a coarse grid of pixels (what the palette engine reads, so the sample's colours are worked out
// from its own pictures). Nothing is read from disk or the network, nothing depends on the clock or on chance: the
// same script always draws the same pictures. No photograph was traced or sampled for any of them; the only words in
// them are MOTEL on a sign and a number on a door. Used by tools/sample-pitch.mjs.

export const W = 1600,
  H = 900;
/** A small seeded generator (mulberry32): the same seed always gives the same numbers, each from 0 up to 1. */
export const seeded = seed => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const lerp = (a, b, t) => a + (b - a) * t;
const r0 = v => Math.round(v);
const pts = list => list.map(([x, y]) => `${r0(x)},${r0(y)}`).join(' ');
const op = o => (o < 1 ? ` opacity="${o}"` : '');
function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// the palette every picture is painted from: dusk blues, dusty pinks, pale salt, one neon red, one warm light
const C = {
  night: '#15142a',
  ink: '#221f38',
  indigo: '#2a2a52',
  plum: '#4a3360',
  mauve: '#7a5a86',
  rose: '#c9807f',
  pink: '#e3a394',
  peach: '#f6cfa6',
  teal: '#1f6f78',
  tealDeep: '#1b4f5c',
  sea: '#7fbcc0',
  salt: '#f4ecdf',
  salt2: '#d9cdbd',
  cream: '#efe4d2',
  sand: '#c99a7e',
  neon: '#ff4b3a',
  warm: '#ffd38a',
  glass: '#2b3558',
};

/** One picture. `draw` is handed the brushes below; shapes are painted in the order they are asked for. */
function picture(id, seed, draw) {
  const defs = [],
    out = [],
    hits = [];
  let n = 0;
  const rand = seeded(seed);
  const add = (svg, hit) => {
    out.push(svg);
    if (hit) hits.push(hit);
  };
  const t = {
    rand,
    /** a band of sky (or ground) the full width, shaded top to bottom through `stops` ([offset 0 to 1, colour]) */
    sky(y0, y1, stops) {
      const g = `${id}-g${n++}`;
      defs.push(
        `<linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`,
      );
      add(`<rect y="${y0}" width="${W}" height="${y1 - y0}" fill="url(#${g})"/>`, (x, y) => {
        if (y < y0 || y >= y1) return null;
        const k = (y - y0) / (y1 - y0);
        let i = 0;
        while (i < stops.length - 2 && k > stops[i + 1][0]) i++;
        const a = rgb(stops[i][1]),
          b = rgb(stops[i + 1][1]),
          u = Math.max(0, Math.min(1, (k - stops[i][0]) / (stops[i + 1][0] - stops[i][0])));
        return [...a.map((v, j) => lerp(v, b[j], u)), 1];
      });
    },
    poly(list, fill, o = 1) {
      add(`<polygon points="${pts(list)}" fill="${fill}"${op(o)}/>`, (x, y) =>
        inside(list, x, y) ? [...rgb(fill), o] : null,
      );
    },
    rect(x, y, w, h, fill, o = 1, rx = 0) {
      add(
        `<rect x="${r0(x)}" y="${r0(y)}" width="${r0(w)}" height="${r0(h)}"${rx ? ` rx="${rx}"` : ''} fill="${fill}"${op(o)}/>`,
        (px, py) => (px >= x && px <= x + w && py >= y && py <= y + h ? [...rgb(fill), o] : null),
      );
    },
    ell(cx, cy, rx, ry, fill, o = 1) {
      add(
        rx === ry
          ? `<circle cx="${r0(cx)}" cy="${r0(cy)}" r="${r0(rx)}" fill="${fill}"${op(o)}/>`
          : `<ellipse cx="${r0(cx)}" cy="${r0(cy)}" rx="${r0(rx)}" ry="${r0(ry)}" fill="${fill}"${op(o)}/>`,
        (x, y) => (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 ? [...rgb(fill), o] : null),
      );
    },
    /** a soft light: `fill` at strength `o` in the middle, nothing at radius `r` */
    glow(cx, cy, r, fill, o) {
      const g = `${id}-g${n++}`;
      defs.push(
        `<radialGradient id="${g}"><stop offset="0" stop-color="${fill}" stop-opacity="${o}"/><stop offset="1" stop-color="${fill}" stop-opacity="0"/></radialGradient>`,
      );
      add(`<circle cx="${r0(cx)}" cy="${r0(cy)}" r="${r0(r)}" fill="url(#${g})"/>`, (x, y) => {
        const d = Math.hypot(x - cx, y - cy) / r;
        return d < 1 ? [...rgb(fill), o * (1 - d)] : null;
      });
    },
    /** a line or several (SVG path data): too thin to matter to the palette, so it is drawn and not counted */
    line(d, stroke, w, o = 1, more = '') {
      add(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}"${op(o)}${more}/>`);
    },
    round(d, stroke, w, o = 1) {
      t.line(d, stroke, w, o, ' stroke-linecap="round" stroke-linejoin="round"');
    },
    /** a rolling skyline from `x0` to `x1` around height `y`, filled down to `base` */
    ridge(y, amp, base, fill, o = 1, x0 = 0, x1 = W, steps = 24) {
      const list = [];
      let v = 0;
      for (let i = 0; i <= steps; i++) {
        v = v * 0.7 + (rand() - 0.5) * 0.95;
        list.push([lerp(x0, x1, i / steps), y + v * amp]);
      }
      t.poly([[x0, base], ...list, [x1, base]], fill, o);
    },
    stars(count, maxY) {
      let d = '';
      for (let i = 0; i < count; i++) {
        const x = r0(rand() * W),
          y = r0(rand() * maxY);
        d += `M${x} ${y}h.1`;
      }
      t.round(d, '#f4eddc', 3, 0.7);
    },
  };
  draw(t);
  // a little grain over everything: two sparse tiles of specks whose sizes share no factor, so no repeat shows
  const speck = (tw, th, count, fill, o) => {
    let d = '';
    for (let i = 0; i < count; i++) d += `M${r0(rand() * tw)} ${r0(rand() * th)}h.1`;
    const g = `${id}-g${n++}`;
    defs.push(
      `<pattern id="${g}" width="${tw}" height="${th}" patternUnits="userSpaceOnUse"><path d="${d}" stroke="${fill}" stroke-width="2.2" stroke-linecap="round" opacity="${o}"/></pattern>`,
    );
    out.push(`<rect width="${W}" height="${H}" fill="url(#${g})"/>`);
  };
  speck(211, 173, 26, '#fff6e4', 0.13);
  speck(157, 199, 26, '#120d1c', 0.12);
  const pixels = [];
  for (let j = 0; j < 36; j++)
    for (let i = 0; i < 64; i++) {
      const x = (i + 0.5) * (W / 64),
        y = (j + 0.5) * (H / 36);
      let c = [0, 0, 0];
      for (const hit of hits) {
        const h = hit(x, y);
        if (h) c = c.map((v, k) => lerp(v, h[k], h[3]));
      }
      pixels.push(c.map(Math.round));
    }
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs.join('')}</defs>${out.join('')}</svg>`,
    pixels,
  };
}

// ---------- shared pieces ----------

/** MOTEL as tubes of light: five letters of straight strokes (and one loop), `h` tall, starting at `x`, `y`. */
function motelWord(x, y, h, lw, gap) {
  const L = i => x + i * (lw + gap),
    b = y + h,
    m = y + h / 2;
  return [
    `M${L(0)} ${b}V${y}L${L(0) + lw / 2} ${y + h * 0.55}L${L(0) + lw} ${y}V${b}`,
    `M${L(1) + lw / 2} ${y}H${L(1) + lw * 0.62}Q${L(1) + lw} ${y} ${L(1) + lw} ${y + lw * 0.42}V${b - lw * 0.42}Q${L(1) + lw} ${b} ${L(1) + lw * 0.62} ${b}H${L(1) + lw * 0.38}Q${L(1)} ${b} ${L(1)} ${b - lw * 0.42}V${y + lw * 0.42}Q${L(1)} ${y} ${L(1) + lw * 0.38} ${y}Z`,
    `M${L(2)} ${y}H${L(2) + lw}M${L(2) + lw / 2} ${y}V${b}`,
    `M${L(3) + lw} ${y}H${L(3)}V${b}H${L(3) + lw}M${L(3)} ${m}H${L(3) + lw * 0.78}`,
    `M${L(4)} ${y}V${b}H${L(4) + lw}`,
  ].join('');
}
/** A row of motel doors, each with a window beside it; `lit` lists the windows with a lamp on. */
function doors(t, x, y, h, step, count, lit, door = C.teal, dark = C.glass) {
  for (let i = 0; i < count; i++) {
    const dx = x + i * step,
      dw = h * 0.42,
      on = lit.includes(i);
    t.rect(dx, y, dw, h, door);
    t.rect(dx + dw * 0.76, y + h * 0.5, dw * 0.1, h * 0.05, C.warm);
    const wx = dx + dw + h * 0.16,
      ww = h * 0.5,
      wh = h * 0.46,
      wy = y + h * 0.12;
    t.rect(wx - 4, wy - 4, ww + 8, wh + 8, C.cream);
    t.rect(wx, wy, ww, wh, on ? C.warm : dark);
    t.rect(wx + ww * 0.44, wy, ww * 0.12, wh, on ? '#f0a85a' : '#3d4a75');
  }
}
/** A palm: a leaning trunk from the ground at `x`, `y` to a crown `h` above, and fronds falling from it. */
function palm(t, x, y, h, lean, size, trunk = '#3a2a44', leaf = '#1f4f55', leaf2 = '#2f6a66') {
  const tx = x + lean,
    ty = y - h;
  t.round(`M${r0(x)} ${r0(y)}Q${r0(x + lean * 0.2)} ${r0(y - h * 0.55)} ${r0(tx)} ${r0(ty)}`, trunk, r0(size * 0.11));
  const fronds = [
    [-1, -0.25],
    [-0.85, 0.35],
    [-0.5, -0.7],
    [0.05, -0.95],
    [0.55, -0.72],
    [0.9, 0.3],
    [1, -0.28],
    [-0.45, 0.75],
    [0.5, 0.78],
  ];
  fronds.forEach(([fx, fy], i) => {
    const ex = tx + fx * size,
      ey = ty + fy * size * 0.8 + Math.abs(fx) * size * 0.25,
      mx = tx + fx * size * 0.55,
      my = ty + fy * size * 0.8 - size * 0.28;
    const nx = -(ey - ty),
      ny = ex - tx,
      len = Math.hypot(nx, ny) || 1,
      wv = size * 0.13;
    t.poly(
      [
        [tx, ty],
        [mx + (nx / len) * wv, my + (ny / len) * wv],
        [ex, ey],
        [mx - (nx / len) * wv * 0.4, my - (ny / len) * wv * 0.4 + size * 0.1],
      ],
      i % 2 ? leaf : leaf2,
    );
  });
  t.ell(tx, ty, size * 0.1, size * 0.1, trunk);
}
/** A low bush: a heap of rounds, darker underneath, a few lit on the side the light comes from. */
function bush(t, x, y, s, dark = '#3d6558', mid = '#4f7a6a', light = '#86a58e') {
  t.ell(x + s * 0.2, y + s * 0.34, s * 1.25, s * 0.16, C.ink, 0.28);
  for (const [dx, dy, r, c] of [
    [-0.7, 0.05, 0.42, dark],
    [0.65, 0.02, 0.46, dark],
    [0, -0.1, 0.6, dark],
    [-0.35, -0.32, 0.4, mid],
    [0.3, -0.4, 0.42, mid],
    [0.62, -0.2, 0.3, mid],
    [0.38, -0.52, 0.2, light],
    [0.7, -0.3, 0.14, light],
    [-0.2, -0.5, 0.16, light],
  ])
    t.ell(x + dx * s, y + dy * s, r * s, r * s * 0.86, c);
}

// ---------- the ten pictures ----------

const PICTURES = [
  {
    id: 'look_sign',
    section: 'world',
    caption: 'The motel from the road at dusk, its sign lit (drawn for the sample)',
    seed: 101,
    draw(t) {
      t.sky(0, 660, [
        [0, '#16254a'],
        [0.45, '#4a3f6e'],
        [0.72, '#b86a7c'],
        [0.9, '#f0a48a'],
        [1, '#f9cfa0'],
      ]);
      t.stars(46, 300);
      t.ridge(590, 46, 662, '#6a4770');
      t.ridge(630, 22, 662, '#45305a');
      t.sky(660, 900, [
        [0, '#2a2440'],
        [1, '#17152a'],
      ]);
      t.poly(
        [
          [0, 742],
          [1600, 812],
          [1600, 900],
          [0, 900],
        ],
        '#221f38',
      );
      t.line('M0 752L1600 826', '#f4eddc', 3, 0.35);
      t.line('M0 800L1600 878', '#f2c14e', 4, 0.5, ' stroke-dasharray="70 60"');
      // the motel: a row of rooms and an office under one flat roof, a line of neon along it
      t.rect(70, 532, 640, 130, '#3d3058');
      t.rect(54, 518, 670, 16, C.night);
      doors(t, 110, 566, 96, 150, 4, [1, 3], C.tealDeep, '#2a2a52');
      t.line('M54 537H724', C.neon, 12, 0.25);
      t.line('M54 537H724', C.neon, 4);
      t.rect(710, 488, 130, 174, '#4b3a66');
      t.rect(694, 474, 162, 16, C.night);
      t.rect(736, 522, 78, 84, C.warm);
      t.rect(770, 522, 8, 84, '#f0a85a');
      t.poly(
        [
          [262, 662],
          [470, 662],
          [520, 716],
          [220, 716],
        ],
        C.warm,
        0.14,
      );
      t.poly(
        [
          [560, 662],
          [640, 662],
          [680, 708],
          [530, 708],
        ],
        C.warm,
        0.14,
      );
      t.poly(
        [
          [736, 662],
          [814, 662],
          [850, 708],
          [700, 708],
        ],
        C.warm,
        0.16,
      );
      // the sign: a dark box high on a pole, the word in red tubes, an arrow under it
      t.glow(1290, 196, 380, C.neon, 0.3);
      t.rect(1281, 250, 18, 478, C.night);
      t.rect(1262, 720, 56, 12, C.night);
      t.rect(1066, 96, 448, 176, C.night, 1, 16);
      t.line('M1086 116H1494V252H1086Z', C.neon, 3, 0.55);
      const word = motelWord(1112, 146, 78, 54, 21);
      t.round(word, C.neon, 30, 0.2);
      t.round(word, C.neon, 11);
      t.round(word, '#ffd9cc', 3, 0.9);
      t.poly(
        [
          [1428, 300],
          [1190, 300],
          [1144, 330],
          [1190, 360],
          [1428, 360],
        ],
        C.night,
      );
      t.round('M1410 330H1184M1206 314L1180 330L1206 346', C.warm, 5);
      t.ell(1290, 744, 240, 26, C.neon, 0.14);
      bush(t, 1540, 780, 40, '#1d1a30', '#2a2542', '#3a3358');
      bush(t, 1000, 740, 30, '#1d1a30', '#2a2542', '#3a3358');
    },
  },
  {
    id: 'look_motel',
    section: 'world',
    caption: 'The motel front: two floors of doors, a railing, the stair (drawn for the sample)',
    seed: 202,
    draw(t) {
      t.sky(0, 700, [
        [0, '#27406b'],
        [0.5, '#7c6a93'],
        [0.8, '#e39a8f'],
        [1, '#f6c9a0'],
      ]);
      t.stars(18, 180);
      t.ridge(590, 40, 702, '#6a4a78');
      t.ridge(640, 24, 702, '#523a66');
      t.sky(700, 900, [
        [0, '#3f3856'],
        [1, '#2a2540'],
      ]);
      for (let i = 0; i < 9; i++) t.line(`M${140 + i * 150} 728L${60 + i * 170} 900`, '#f4eddc', 4, 0.28);
      // the building
      t.rect(120, 232, 1120, 470, '#d78e88');
      t.rect(120, 470, 1120, 232, '#c47c7c');
      t.rect(120, 470, 1120, 34, C.ink, 0.28);
      doors(t, 160, 300, 150, 176, 6, [0, 3]);
      doors(t, 160, 550, 150, 176, 6, [2, 4, 5]);
      t.rect(96, 450, 1168, 22, C.cream);
      t.rect(96, 208, 1188, 26, C.ink);
      t.rect(96, 234, 1188, 6, C.neon);
      t.line('M96 237H1284', C.neon, 16, 0.22);
      for (let i = 0; i < 7; i++) t.rect(128 + i * 176, 472, 9, 230, C.cream);
      let bal = '';
      for (let x = 104; x <= 1260; x += 22) bal += `M${x} 388V450`;
      t.line(bal, C.ink, 3, 0.85);
      t.line('M96 386H1264', C.ink, 7);
      // the stair at the end of the walk
      t.poly(
        [
          [1264, 450],
          [1296, 450],
          [1500, 702],
          [1456, 702],
        ],
        C.ink,
      );
      let steps = 'M1264 450';
      for (let i = 0; i < 9; i++) steps += `h24v28`;
      t.line(steps, C.cream, 5);
      t.line('M1264 386L1300 386L1504 638V702M1300 386V450M1368 470V534M1436 554V618', C.ink, 6);
      t.rect(1236, 232, 12, 470, '#b76f72');
      // a lamp at the kerb
      t.glow(1548, 300, 210, C.warm, 0.4);
      t.rect(1543, 300, 10, 402, C.ink);
      t.ell(1548, 298, 20, 12, C.warm);
      t.rect(0, 700, 1600, 8, '#cbb9b4', 0.6);
      bush(t, 60, 706, 40, '#2d3a55', '#3b4c68', '#57698a');
    },
  },
  {
    id: 'look_door',
    section: 'world',
    caption: 'Room 7: the door, the porch light, the chair nobody moves (drawn for the sample)',
    seed: 303,
    draw(t) {
      t.sky(0, 760, [
        [0, '#b97379'],
        [0.5, '#cf8a84'],
        [1, '#c27c7d'],
      ]);
      t.rect(0, 0, 1600, 74, C.ink);
      t.poly(
        [
          [0, 74],
          [1600, 74],
          [1600, 122],
          [0, 168],
        ],
        '#8c5868',
        0.55,
      );
      t.rect(0, 700, 1600, 60, '#a2646e');
      t.sky(760, 900, [
        [0, '#5a5270'],
        [1, '#3f3a58'],
      ]);
      t.line('M0 762H1600', '#d9cdbd', 4, 0.5);
      t.line('M0 840H1600', C.ink, 2, 0.25);
      // the porch light and what it lights
      t.glow(930, 236, 420, C.warm, 0.5);
      t.poly(
        [
          [905, 262],
          [955, 262],
          [1180, 760],
          [560, 760],
        ],
        C.warm,
        0.1,
      );
      // the door
      t.rect(604, 194, 272, 566, C.cream);
      t.rect(620, 210, 240, 550, C.teal);
      t.line('M650 250H830V440H650ZM650 480H830V720H650Z', C.tealDeep, 6);
      t.ell(832, 500, 11, 11, '#e9c46a');
      t.rect(708, 286, 64, 74, C.cream, 1, 6);
      t.round('M724 306H756L736 342', C.ink, 7);
      t.rect(600, 756, 280, 14, '#2f2a44');
      t.rect(916, 214, 28, 14, C.ink);
      t.ell(930, 244, 18, 20, C.warm);
      t.ell(930, 244, 9, 10, '#fff3d6');
      // the window and the cooler under it
      t.rect(1056, 276, 388, 300, C.cream);
      t.rect(1072, 292, 356, 268, C.glass);
      t.poly(
        [
          [1072, 292],
          [1180, 292],
          [1128, 560],
          [1072, 560],
        ],
        '#44527f',
      );
      t.poly(
        [
          [1428, 292],
          [1320, 292],
          [1372, 560],
          [1428, 560],
        ],
        '#44527f',
      );
      t.rect(1244, 292, 12, 268, C.cream);
      t.rect(1150, 590, 200, 96, '#8f8a9c');
      t.line('M1166 610H1334M1166 630H1334M1166 650H1334M1166 670H1334', '#5f5a70', 5);
      // the chair
      t.ell(392, 772, 150, 16, C.ink, 0.3);
      t.round('M300 760L318 610M484 760L466 610M318 610H466M306 700H478', '#e9e2d6', 9);
      t.rect(312, 470, 160, 130, '#d9604c', 1, 26);
      t.line('M352 482V588M392 482V588M432 482V588', '#b84a3c', 5);
      t.poly(
        [
          [298, 612],
          [486, 612],
          [500, 648],
          [284, 648],
        ],
        '#d9604c',
      );
      t.round('M296 590H270V676M488 590H514V676', '#e9e2d6', 9);
    },
  },
  {
    id: 'look_flats',
    section: 'world',
    caption: 'The flats: white to the horizon, and the stone (drawn for the sample)',
    seed: 404,
    draw(t) {
      t.sky(0, 540, [
        [0, '#2f6f8c'],
        [0.55, '#8fc0c9'],
        [0.85, '#f3d3c2'],
        [1, '#f8e4d2'],
      ]);
      t.ell(1180, 250, 320, 10, '#f8e4d2', 0.4);
      t.ell(980, 296, 260, 6, '#f8e4d2', 0.35);
      t.ell(380, 190, 240, 7, '#f8e4d2', 0.3);
      t.ridge(506, 26, 542, '#a9b8ce');
      t.ridge(524, 13, 542, '#8196b5', 1, 0, 1600, 30);
      t.sky(540, 900, [
        [0, '#f7f0e6'],
        [0.4, '#f1e7da'],
        [1, '#e6dacb'],
      ]);
      t.rect(0, 540, 1600, 10, '#c9d6de', 0.7);
      // the cracks: a honeycomb on the ground, seen flat on, nearer cells larger
      const P = (X, Z) => [800 + (X * 470) / Z, 540 + 400 / Z],
        R = 0.62,
        bands = ['', '', ''];
      const jit = new Map(),
        corner = (q, r) => {
          const k = `${q},${r}`;
          if (!jit.has(k)) jit.set(k, [(t.rand() - 0.5) * 0.3 * R, (t.rand() - 0.5) * 0.3 * R]);
          return jit.get(k);
        };
      for (let row = 0; row < 12; row++)
        for (let col = -16; col <= 16; col++) {
          const cz = 1.15 + row * R * 1.5,
            cx = col * R * 1.732 + (row % 2 ? R * 0.866 : 0);
          const v = [0, 1, 2, 3].map(k => {
            const a = Math.PI / 6 + (k * Math.PI) / 3,
              x = cx + R * Math.cos(a),
              z = cz + R * Math.sin(a),
              j = corner(Math.round(x / (R * 0.866)), Math.round(z / (R * 0.5)));
            return [x + j[0], z + j[1]];
          });
          for (let k = 0; k < 3; k++) {
            const [a, b] = [v[k], v[k + 1]];
            if (a[1] < 1.02 || b[1] < 1.02) continue;
            const p = P(...a),
              q = P(...b);
            if (Math.max(p[0], q[0]) < -40 || Math.min(p[0], q[0]) > 1640 || Math.min(p[1], q[1]) > 910) continue;
            bands[cz < 2.2 ? 0 : cz < 4.5 ? 1 : 2] += `M${r0(p[0])} ${r0(p[1])}L${r0(q[0])} ${r0(q[1])}`;
          }
        }
      t.round(bands[2], '#cdbfb0', 1.5, 0.8);
      t.round(bands[1], '#c6b6a6', 3, 0.85);
      t.round(bands[0], '#bdac9c', 5, 0.9);
      // the stone, and the long shadow it throws
      t.poly(
        [
          [1124, 698],
          [1204, 702],
          [770, 724],
          [700, 714],
        ],
        '#b9a9b5',
        0.75,
      );
      t.poly(
        [
          [1120, 702],
          [1132, 664],
          [1164, 646],
          [1196, 660],
          [1208, 700],
        ],
        '#5d566e',
      );
      t.poly(
        [
          [1164, 646],
          [1196, 660],
          [1208, 700],
          [1176, 702],
        ],
        '#3f3a55',
      );
    },
  },
  {
    id: 'look_moon',
    section: 'tone',
    caption: 'Blue hour: the moon comes up over the hills (drawn for the sample)',
    seed: 505,
    draw(t) {
      t.sky(0, 720, [
        [0, '#12224a'],
        [0.5, '#2f4f86'],
        [0.78, '#8f7fb0'],
        [0.92, '#e7a3a6'],
        [1, '#f4c2a8'],
      ]);
      t.stars(40, 330);
      t.glow(1090, 470, 300, '#f6ecd6', 0.3);
      t.ell(1090, 470, 84, 84, '#f6ecd6');
      t.ell(1062, 446, 16, 14, '#e4d6bc');
      t.ell(1112, 500, 22, 19, '#e4d6bc');
      t.ell(1124, 440, 9, 8, '#e4d6bc');
      t.ell(1068, 506, 8, 7, '#e4d6bc');
      t.ell(1260, 556, 210, 9, '#e7a3a6', 0.6);
      t.ell(860, 600, 250, 8, '#f4c2a8', 0.5);
      t.ridge(600, 58, 902, '#6a6aa3');
      t.ridge(668, 52, 902, '#474a86');
      t.ridge(742, 36, 902, '#272b5c');
      t.ridge(812, 16, 902, '#14173a', 1, 0, 1600, 32);
      for (const [x, y, s] of [
        [180, 806, 34],
        [470, 818, 22],
        [760, 822, 28],
        [1010, 812, 20],
        [1330, 808, 38],
        [1520, 824, 24],
      ])
        bush(t, x, y, s, '#0e1030', '#161a40', '#1e2350');
    },
  },
  {
    id: 'look_dunes',
    section: 'tone',
    caption: 'The dunes, late: one side lit, one side gone blue (drawn for the sample)',
    seed: 606,
    draw(t) {
      t.sky(0, 560, [
        [0, '#2c5f7d'],
        [0.6, '#86b3be'],
        [1, '#f2cdbb'],
      ]);
      t.ridge(498, 22, 562, '#8f93b8');
      /** a dune: a smooth hump lit from the left, its far side in shadow from the crest down a wandering edge */
      const dune = (px, py, base, wl, wr, lit, shade, sway) => {
        const top = x => base - (base - py) * Math.exp(-(((x - px) / (x < px ? wl : wr)) ** 2));
        const hump = [];
        for (let x = px - wl * 2.4; x <= px + wr * 2.4; x += 40) hump.push([x, top(x)]);
        t.poly([[px - wl * 2.4, H], ...hump, [px + wr * 2.4, H]], lit);
        const edge = [];
        for (let k = 0; k <= 10; k++) {
          const y = lerp(py, base + 4, k / 10);
          edge.push([px + (k / 10) * sway + Math.sin(k * 0.9) * sway * 0.22, y]);
        }
        const foot = [];
        for (let k = 1; k < 8; k++)
          foot.push([
            lerp(px + wr * 2.4, px + sway, k / 8),
            base + 4 + Math.sin((k / 8) * Math.PI) * (base - py) * 0.2,
          ]);
        const right = hump.filter(([x]) => x > px);
        t.poly([[px, py], ...right, [px + wr * 2.4, base + 4], ...foot, ...edge.reverse()], shade);
      };
      t.sky(556, 900, [
        [0, '#e9c1ac'],
        [1, '#f2d6bd'],
      ]);
      dune(1180, 392, 600, 300, 230, '#f0c8b0', '#8b86ad', 150);
      dune(420, 440, 660, 330, 300, '#f3d2b8', '#7f7ba6', 230);
      dune(1010, 560, 800, 420, 330, '#f6dcc4', '#6d6a9a', 300);
      dune(240, 700, 904, 420, 420, '#f8e4cf', '#5d5a8c', 380);
    },
  },
  {
    id: 'look_road',
    section: 'tone',
    caption: 'The road out: two lanes, a telegraph line, nobody (drawn for the sample)',
    seed: 707,
    draw(t) {
      t.sky(0, 500, [
        [0, '#1f4b6e'],
        [0.5, '#6f9fb2'],
        [0.8, '#f0b9a6'],
        [1, '#f9d9b0'],
      ]);
      t.glow(940, 500, 330, C.warm, 0.45);
      t.poly(
        [
          [0, 502],
          [0, 452],
          [150, 446],
          [190, 420],
          [420, 418],
          [452, 448],
          [600, 456],
          [640, 502],
        ],
        '#8a6f98',
      );
      t.poly(
        [
          [1040, 502],
          [1090, 462],
          [1300, 458],
          [1330, 436],
          [1500, 434],
          [1530, 470],
          [1600, 474],
          [1600, 502],
        ],
        '#75608a',
      );
      t.ridge(486, 9, 502, '#a98aa6', 1, 560, 1100, 12);
      t.sky(500, 900, [
        [0, '#d7a58c'],
        [0.35, '#c99582'],
        [1, '#a97a70'],
      ]);
      // the road, in from the bottom of the picture to a point on the horizon
      const vx = 930;
      t.poly(
        [
          [vx - 5, 500],
          [vx + 5, 500],
          [1330, 900],
          [330, 900],
        ],
        '#3b3552',
      );
      t.poly(
        [
          [vx - 5, 500],
          [vx - 4, 500],
          [372, 900],
          [330, 900],
        ],
        '#efe4d2',
        0.8,
      );
      t.poly(
        [
          [vx + 4, 500],
          [vx + 5, 500],
          [1330, 900],
          [1292, 900],
        ],
        '#efe4d2',
        0.8,
      );
      for (let k = 0; k < 9; k++) {
        const a = 0.9 ** (k * 3),
          b = a * 0.8;
        const y0 = 500 + 400 * a,
          y1 = 500 + 400 * b,
          c = y => vx - ((y - 500) / 400) * 100,
          w = y => ((y - 500) / 400) * 9;
        t.poly(
          [
            [c(y0) - w(y0), y0],
            [c(y0) + w(y0), y0],
            [c(y1) + w(y1), y1],
            [c(y1) - w(y1), y1],
          ],
          '#f2c14e',
        );
      }
      // the telegraph line down the left of it
      const pole = z => {
        const s = 1 / z;
        return { x: vx - 760 * s, y: 500 + 400 * s, h: 560 * s, a: 120 * s, w: Math.max(2, 16 * s) };
      };
      const poles = [1.12, 1.75, 2.75, 4.3, 6.8, 11].map(pole);
      poles.forEach((p, i) => {
        const next = poles[i + 1];
        if (next)
          for (const side of [-1, 1])
            t.line(
              `M${r0(p.x + side * p.a * 0.5)} ${r0(p.y - p.h + p.a * 0.1)}Q${r0((p.x + next.x) / 2 + side * (p.a + next.a) * 0.25)} ${r0((p.y - p.h + next.y - next.h) / 2 + p.h * 0.1)} ${r0(next.x + side * next.a * 0.5)} ${r0(next.y - next.h + next.a * 0.1)}`,
              C.ink,
              Math.max(1, p.w * 0.16),
              0.8,
            );
      });
      for (const side of [-1, 1])
        t.line(
          `M${r0(poles[0].x + side * poles[0].a * 0.5)} ${r0(poles[0].y - poles[0].h + 12)}Q${r0(poles[0].x - 200 + side * 60)} ${r0(poles[0].y - poles[0].h + 70)} ${-20} ${r0(poles[0].y - poles[0].h - 40 + side * 30)}`,
          C.ink,
          2.5,
          0.8,
        );
      for (const p of poles) {
        t.rect(p.x - p.w / 2, p.y - p.h, p.w, p.h, C.ink);
        t.rect(p.x - p.a / 2, p.y - p.h + p.a * 0.08, p.a, Math.max(2, p.w * 0.6), C.ink);
      }
      // scrub on the near shoulder
      bush(t, 1400, 800, 92);
      bush(t, 1210, 640, 26);
      bush(t, 180, 700, 34);
      bush(t, 620, 580, 14);
      bush(t, 1560, 610, 20);
      t.round('M1330 760L1300 690M1380 730L1372 660M1450 740L1484 676M1500 780L1552 730', '#3d6558', 5);
    },
  },
  {
    id: 'look_pool',
    section: 'world',
    caption: 'The pool, empty since the autumn, and the two palms (drawn for the sample)',
    seed: 808,
    draw(t) {
      t.sky(0, 470, [
        [0, '#234a70'],
        [0.6, '#8a7fa8'],
        [1, '#f0a999'],
      ]);
      t.stars(16, 150);
      t.ridge(400, 30, 472, '#5f4c7c');
      // the motel behind
      t.rect(60, 292, 860, 180, '#dfa193');
      t.rect(60, 292, 860, 30, C.ink, 0.22);
      doors(t, 110, 352, 120, 168, 5, [3]);
      t.rect(40, 272, 900, 22, C.ink);
      t.line('M40 297H940', C.neon, 4, 0.9);
      for (let i = 0; i < 6; i++) t.rect(86 + i * 168, 294, 8, 178, C.cream);
      t.sky(470, 900, [
        [0, '#b99ea6'],
        [1, '#d9c6ba'],
      ]);
      t.rect(0, 470, 1600, 8, '#8f7890', 0.6);
      palm(t, 1150, 520, 400, 40, 190);
      palm(t, 1390, 510, 270, -30, 140);
      // the pool: a pale rim, the far wall and both sides down to a sloping floor, a little rain left at the deep end
      t.poly(
        [
          [470, 560],
          [1330, 540],
          [1570, 866],
          [250, 890],
        ],
        C.cream,
      );
      t.poly(
        [
          [510, 580],
          [1300, 562],
          [1500, 832],
          [330, 852],
        ],
        '#cfe9e0',
      );
      t.poly(
        [
          [510, 580],
          [1300, 562],
          [1280, 640],
          [560, 654],
        ],
        '#9fd0cf',
      );
      t.poly(
        [
          [510, 580],
          [560, 654],
          [420, 812],
          [330, 852],
        ],
        '#7fbcc0',
      );
      t.poly(
        [
          [1300, 562],
          [1280, 640],
          [1420, 800],
          [1500, 832],
        ],
        '#b7ded8',
      );
      t.poly(
        [
          [560, 654],
          [1280, 640],
          [1420, 800],
          [420, 812],
        ],
        '#d9efe6',
      );
      t.poly(
        [
          [900, 648],
          [1280, 640],
          [1420, 800],
          [1000, 806],
        ],
        '#c4e3dc',
      );
      t.line('M510 592L1300 574M517 590L340 858M1293 573L1490 838', C.teal, 6, 0.7);
      t.line('M700 652L640 808M900 648L880 806M1100 644L1140 803', '#a9cfcb', 3, 0.7);
      t.ell(1180, 740, 150, 34, C.teal, 0.75);
      t.ell(1150, 734, 70, 12, '#8fd0cc', 0.6);
      t.round(
        'M1380 610Q1380 560 1410 560Q1436 560 1436 600M1446 690Q1446 640 1476 640Q1502 640 1502 680',
        '#efe9dd',
        8,
      );
      t.round('M1380 610V650M1446 690V730', '#efe9dd', 8);
      // a chair left out
      t.round('M150 640L360 640L420 590M170 640V690M340 640V690', '#efe9dd', 9);
      t.poly(
        [
          [150, 630],
          [360, 630],
          [424, 578],
          [404, 570],
          [350, 616],
          [150, 616],
        ],
        '#d9604c',
      );
    },
  },
  {
    id: 'look_sun',
    section: 'tone',
    caption: 'Last light: the sun going down behind the ridge (drawn for the sample)',
    seed: 909,
    draw(t) {
      t.sky(0, 640, [
        [0, '#231a45'],
        [0.42, '#6a2f5f'],
        [0.74, '#c6483f'],
        [1, '#f59a4e'],
      ]);
      t.stars(22, 200);
      t.glow(660, 590, 620, '#ff7a3a', 0.5);
      t.ell(660, 590, 196, 196, '#f6402e');
      t.ell(660, 590, 150, 150, '#ff5a36', 0.6);
      t.rect(350, 452, 470, 20, '#4a2148', 0.9, 10);
      t.rect(560, 508, 520, 16, '#4a2148', 0.85, 8);
      t.rect(240, 548, 300, 12, '#4a2148', 0.7, 6);
      t.rect(900, 420, 380, 12, '#6a2f5f', 0.7, 6);
      t.poly(
        [
          [0, 642],
          [0, 560],
          [120, 548],
          [220, 500],
          [300, 520],
          [380, 596],
          [470, 610],
          [560, 640],
          [760, 632],
          [860, 580],
          [960, 560],
          [1040, 486],
          [1100, 470],
          [1170, 400],
          [1230, 384],
          [1300, 450],
          [1380, 470],
          [1470, 540],
          [1600, 556],
          [1600, 642],
        ],
        '#3c1a3c',
      );
      t.poly(
        [
          [0, 660],
          [0, 610],
          [160, 596],
          [300, 624],
          [460, 628],
          [640, 634],
          [820, 630],
          [940, 612],
          [1060, 600],
          [1180, 540],
          [1250, 524],
          [1340, 580],
          [1480, 600],
          [1600, 590],
          [1600, 660],
        ],
        '#1d1228',
      );
      t.sky(650, 900, [
        [0, '#1d1228'],
        [1, '#120d1c'],
      ]);
      t.rect(380, 700, 620, 4, '#f59a4e', 0.5, 2);
      t.rect(470, 740, 420, 4, '#f59a4e', 0.34, 2);
      t.rect(540, 790, 280, 5, '#f59a4e', 0.22, 2);
      t.rect(600, 850, 160, 6, '#f59a4e', 0.14, 3);
    },
  },
  {
    id: 'look_wagon',
    section: 'tone',
    caption: 'The wagon on the flats, small against the sky (drawn for the sample)',
    seed: 111,
    draw(t) {
      t.sky(0, 580, [
        [0, '#35668c'],
        [0.5, '#97b8c9'],
        [0.8, '#f2c4b4'],
        [1, '#f9ddc2'],
      ]);
      t.glow(1500, 570, 360, C.warm, 0.5);
      t.ell(520, 260, 300, 12, '#f9ddc2', 0.45);
      t.ell(820, 330, 220, 9, '#f9ddc2', 0.4);
      t.ridge(552, 18, 582, '#9aa5c4');
      t.ridge(566, 9, 582, '#7f8db2', 1, 0, 1600, 30);
      t.sky(580, 900, [
        [0, '#f6efe4'],
        [1, '#e5d9ca'],
      ]);
      t.rect(0, 580, 1600, 8, '#c9d2de', 0.7);
      t.line('M0 640H520M700 668H1000M0 750H900M1100 790H1600M200 840H1300', '#d3c5b6', 2, 0.7);
      t.line('M0 700L1235 684M0 718L1235 692', '#cdbcae', 3, 0.6);
      // the long shadow, then the car: a boxy wagon, side on
      const ox = 330,
        oy = 24,
        at = list => list.map(([x, y]) => [x + ox, y + oy]);
      t.poly(
        at([
          [900, 664],
          [1196, 664],
          [1100, 686],
          [330, 700],
        ]),
        '#a99bb0',
        0.7,
      );
      t.rect(884 + ox, 606 + oy, 316, 44, '#b9503c', 1, 8);
      t.rect(884 + ox, 620 + oy, 316, 16, '#8a5a3c');
      t.poly(
        at([
          [896, 608],
          [906, 566],
          [1072, 566],
          [1104, 608],
        ]),
        '#c96249',
      );
      t.poly(
        at([
          [914, 604],
          [920, 576],
          [962, 576],
          [962, 604],
        ]),
        C.glass,
      );
      t.poly(
        at([
          [970, 604],
          [970, 576],
          [1016, 576],
          [1016, 604],
        ]),
        C.glass,
      );
      t.poly(
        at([
          [1024, 604],
          [1024, 576],
          [1064, 576],
          [1086, 604],
        ]),
        C.glass,
      );
      t.poly(
        at([
          [1030, 600],
          [1030, 580],
          [1058, 580],
          [1074, 600],
        ]),
        '#f2c4b4',
        0.5,
      );
      t.line(`M${912 + ox} ${562 + oy}h154M${930 + ox} ${562 + oy}v4M${1050 + ox} ${562 + oy}v4`, C.ink, 4);
      t.rect(956 + ox, 544 + oy, 62, 18, '#d9b48a', 1, 3);
      t.rect(1022 + ox, 550 + oy, 30, 12, '#5d7a8a', 1, 2);
      t.rect(876 + ox, 634 + oy, 14, 10, '#d9cdbd');
      t.rect(1194 + ox, 634 + oy, 14, 10, '#d9cdbd');
      t.rect(1192 + ox, 612 + oy, 8, 10, C.warm);
      t.rect(884 + ox, 612 + oy, 6, 12, '#7a2f2a');
      t.ell(940 + ox, 652 + oy, 23, 23, C.night);
      t.ell(940 + ox, 652 + oy, 9, 9, '#cfc6b8');
      t.ell(1138 + ox, 652 + oy, 23, 23, C.night);
      t.ell(1138 + ox, 652 + oy, 9, 9, '#cfc6b8');
    },
  },
];

/** Every picture, drawn: its id, caption and section, the SVG text, and 64 by 36 pixels of it for the palette. */
export function drawPictures() {
  return PICTURES.map(p => ({ id: p.id, caption: p.caption, section: p.section, ...picture(p.id, p.seed, p.draw) }));
}
