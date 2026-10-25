import { realmCenters, realmOrder, type Realm } from "./world-math";
export type WorldExhibit = {
  id: string;
  realm: Realm;
  url: string;
  originalUrl: string;
  sourceUrl: string;
  title: string;
  aspect: number;
  sourceClass: string;
  sourceId?: string;
  assetIndex?: number;
};
export type ExhibitPosition = {
  asset: WorldExhibit;
  position: [number, number, number];
  yaw: number;
  slot: number;
  width: number;
  height: number;
};
type Color = readonly [number, number, number];
export function buildWorld(exhibits: WorldExhibit[]) {
  const vertices: number[] = [];
  const wood: Color = [0.3, 0.16, 0.075],
    stone: Color = [0.76, 0.68, 0.49],
    paper: Color = [0.86, 0.82, 0.7],
    brass: Color = [0.72, 0.46, 0.13];
  const put = (
    p: number[],
    n: number[],
    uv: number[],
    c: Color,
    texture = -1,
    glow = 0,
  ) => vertices.push(...p, ...n, ...uv, ...c, 1, texture, glow);
  function face(
    points: number[][],
    normal: number[],
    c: Color,
    texture = -1,
    glow = 0,
  ) {
    for (const i of [0, 1, 2, 0, 2, 3])
      put(
        points[i]!,
        normal,
        [
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ][i]!,
        c,
        texture,
        glow,
      );
  }
  function box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    c: Color,
    glow = 0,
  ) {
    const a = x - w / 2,
      b = x + w / 2,
      l = y - h / 2,
      t = y + h / 2,
      f = z + d / 2,
      k = z - d / 2;
    face(
      [
        [a, l, f],
        [b, l, f],
        [b, t, f],
        [a, t, f],
      ],
      [0, 0, 1],
      c,
      -1,
      glow,
    );
    face(
      [
        [b, l, k],
        [a, l, k],
        [a, t, k],
        [b, t, k],
      ],
      [0, 0, -1],
      c,
      -1,
      glow,
    );
    face(
      [
        [b, l, f],
        [b, l, k],
        [b, t, k],
        [b, t, f],
      ],
      [1, 0, 0],
      c,
      -1,
      glow,
    );
    face(
      [
        [a, l, k],
        [a, l, f],
        [a, t, f],
        [a, t, k],
      ],
      [-1, 0, 0],
      c,
      -1,
      glow,
    );
    face(
      [
        [a, t, f],
        [b, t, f],
        [b, t, k],
        [a, t, k],
      ],
      [0, 1, 0],
      c,
      -1,
      glow,
    );
    face(
      [
        [a, l, k],
        [b, l, k],
        [b, l, f],
        [a, l, f],
      ],
      [0, -1, 0],
      c,
      -1,
      glow,
    );
  }
  function ring(
    cx: number,
    cy: number,
    cz: number,
    r: number,
    tube: number,
    c: Color,
    glow = 0,
    arc = Math.PI * 2,
  ) {
    const major = 48,
      minor = 8;
    for (let i = 0; i < major; i++)
      for (let j = 0; j < minor; j++) {
        const point = (u: number, v: number) => {
          const a = (u / major) * arc,
            b = (v / minor) * Math.PI * 2;
          return {
            p: [
              cx + (r + tube * Math.cos(b)) * Math.cos(a),
              cy + (r + tube * Math.cos(b)) * Math.sin(a),
              cz + tube * Math.sin(b),
            ],
            n: [
              Math.cos(b) * Math.cos(a),
              Math.cos(b) * Math.sin(a),
              Math.sin(b),
            ],
          };
        };
        const corners = [
          point(i, j),
          point(i + 1, j),
          point(i + 1, j + 1),
          point(i, j + 1),
        ];
        for (const index of [0, 1, 2, 0, 2, 3]) {
          const v = corners[index]!;
          put(v.p, v.n, [0, 0], c, -1, glow);
        }
      }
  }
  // Original spatial architecture, not an assertion of a canonical building replica.
  box(0, -0.35, -12, 48, 0.7, 54, stone);
  for (let z = -37; z < 15; z += 1.1)
    for (let x = -23; x < 24; x += 4) {
      box(x + 0.05, 0.015, z, 3.92, 0.06, 1.03, [
        (x + z) % 3 === 0 ? 0.39 : 0.34,
        0.22,
        0.12,
      ]);
    }
  box(-24, 4, -12, 0.7, 8, 54, stone);
  box(24, 4, -12, 0.7, 8, 54, stone);
  box(0, 4, -38, 48, 8, 0.7, stone);
  for (const x of [-6, 6]) box(x, 3.8, -24, 0.5, 7.6, 28, stone);
  for (const x of [-22, -18, -6, 6, 18, 22])
    for (const z of [-6, 4, 12]) {
      box(x, 3.8, z, 0.55, 7.6, 0.65, wood);
      box(x, 0.3, z, 1.05, 0.6, 1.1, stone);
      box(x, 7.4, z, 1, 0.6, 1.2, brass);
    }
  for (const z of [-34, -24, -14, -6, 4, 12]) {
    box(0, 8.1, z, 48, 0.5, 0.6, wood);
    for (const x of [-18, -6, 6, 18]) box(x, 6.8, z, 0.25, 2.6, 0.25, wood);
  }
  // Raised side terraces, benches and stone plinths make distance and occlusion visible.
  for (const x of [-18, 18]) {
    box(x, 0.15, 6, 4, 0.3, 4, stone);
    box(x, 1.1, 6, 3, 0.25, 1.4, wood);
    for (const leg of [-1, 1]) box(x + leg, 0.55, 6, 0.25, 1, 0.9, wood);
  }
  // Vaulted timber roof, an open central skylight, and guild tavern furniture.
  face(
    [
      [-24, 8, 15],
      [-24, 8, -38],
      [-6, 12, -38],
      [-6, 12, 15],
    ],
    [0.217, -0.976, 0],
    [0.32, 0.16, 0.07],
  );
  face(
    [
      [6, 12, 15],
      [6, 12, -38],
      [24, 8, -38],
      [24, 8, 15],
    ],
    [-0.217, -0.976, 0],
    [0.32, 0.16, 0.07],
  );
  for (const x of [-12, 12]) {
    for (const z of [2, 9]) {
      box(x, 1.1, z, 5, 0.22, 2.4, wood);
      for (const side of [-1, 1]) {
        box(x, 0.65, z + side * 1.8, 5, 0.2, 0.65, wood);
        for (const leg of [-1, 1]) {
          box(x + leg * 1.8, 0.53, z + side * 0.85, 0.22, 1.05, 0.22, wood);
          box(x + leg * 1.8, 0.3, z + side * 1.8, 0.2, 0.6, 0.5, wood);
        }
      }
    }
  }
  // A side counter and high shelves; authored architecture carries source exhibits.
  box(-22, 1.25, 0, 2.4, 2.5, 8, wood);
  box(-22, 2.6, 0, 3, 0.2, 8.4, brass);
  for (const z of [-2, 0, 2]) {
    box(-19.6, 0.65, z, 0.8, 0.12, 0.8, wood);
    box(-19.6, 0.3, z, 0.22, 0.6, 0.22, wood);
  }
  for (const x of [-23.5, 23.5])
    for (const z of [-28, -18, 0, 10]) {
      box(x, 4.8, z, 0.15, 4.2, 3.4, [0.12, 0.33, 0.35]);
      box(
        x + (x < 0 ? 0.1 : -0.1),
        4.8,
        z,
        0.1,
        3.7,
        2.9,
        [0.33, 0.63, 0.72],
        0.65,
      );
      box(
        x + (x < 0 ? 0.17 : -0.17),
        4.8,
        z,
        0.12,
        0.15,
        3,
        [0.12, 0.33, 0.35],
      );
      box(
        x + (x < 0 ? 0.17 : -0.17),
        4.8,
        z,
        0.12,
        3.8,
        0.15,
        [0.12, 0.33, 0.35],
      );
    }
  const accents: Record<Realm, Color> = {
    manga: [0.72, 0.67, 0.52],
    anime: [0.82, 0.32, 0.08],
    games: [0.11, 0.55, 0.65],
  };
  const positions: ExhibitPosition[] = [];
  for (const realm of realmOrder) {
    const cx = realmCenters[realm],
      accent = accents[realm];
    // Full volumetric arch and luminous trim, open through the center.
    box(cx - 3.6, 2.7, -8, 0.9, 5.4, 1.2, stone);
    box(cx + 3.6, 2.7, -8, 0.9, 5.4, 1.2, stone);
    ring(cx, 5.1, -8, 3.6, 0.45, stone, 0, Math.PI);
    ring(cx, 5.1, -7.34, 3.15, 0.065, accent, 2.5, Math.PI);
    box(cx - 3.15, 2.5, -7.34, 0.1, 5, 0.1, accent, 2.5);
    box(cx + 3.15, 2.5, -7.34, 0.1, 5, 0.1, accent, 2.5);
    for (let step = 0; step < 3; step++)
      box(cx, 0.06 + step * 0.035, -7.5 - step * 0.45, 6.5, 0.12, 0.42, paper);
    const artworks = exhibits
      .filter((asset) => asset.realm === realm)
      .slice(0, 7);
    artworks.forEach((asset, index) => {
      const hero = index === 0,
        side = index % 2 === 0 ? 1 : -1;
      const position: [number, number, number] = hero
        ? [cx, 3.4, -35]
        : [cx + side * 5.5, 3.2, -16 - Math.floor((index - 1) / 2) * 7.7];
      const yaw = hero ? 0 : side < 0 ? Math.PI / 2 : -Math.PI / 2;
      const height = hero ? 5.1 : 3.9,
        width = Math.min(hero ? 5.6 : 4.8, height * asset.aspect);
      const artHeight = width / asset.aspect;
      const slot = exhibits.indexOf(asset);
      positions.push({ asset, position, yaw, slot, width, height: artHeight });
      const [x, y, z] = position;
      if (hero) {
        box(x, 0.45, z, Math.max(2, width + 0.7), 0.9, 1.6, stone);
        box(x, y, z - 0.12, width + 0.32, artHeight + 0.32, 0.22, wood);
      } else if (side > 0)
        box(x + 0.12, y, z, 0.22, artHeight + 0.28, width + 0.28, wood);
      else box(x - 0.12, y, z, 0.22, artHeight + 0.28, width + 0.28, wood);
      const local = [
        [-width / 2, -artHeight / 2],
        [width / 2, -artHeight / 2],
        [width / 2, artHeight / 2],
        [-width / 2, artHeight / 2],
      ];
      face(
        local.map(([px, py]) => [
          x + px! * Math.cos(yaw),
          y + py!,
          z - px! * Math.sin(yaw),
        ]),
        [Math.sin(yaw), 0, Math.cos(yaw)],
        [1, 1, 1],
        slot,
        0,
      );
    });
    // Real 3D book volumes and display furniture; no invented cover art.
    for (const side of [-1, 1])
      for (let row = 0; row < 3; row++) {
        const sx = cx + side * 4.9;
        box(sx, 1 + row * 0.65, -33, 1.4, 0.12, 3.4, wood);
        for (let book = 0; book < 12; book++)
          box(
            sx,
            1.26 + row * 0.65,
            -34.4 + book * 0.25,
            0.85,
            0.45,
            0.2,
            book % 3 ? paper : accent,
          );
      }
    for (const z of [-15, -24, -33])
      for (const x of [cx - 4.6, cx + 4.6]) {
        box(x, 5.7, z, 0.35, 0.6, 0.35, brass);
        box(x, 6.15, z, 0.2, 0.55, 0.2, accent, 2.8);
      }
  }
  return {
    vertices: new Float32Array(vertices),
    positions,
    vertexCount: vertices.length / 14,
  };
}
