import { identity } from "./math";
export type Vec3 = readonly [number, number, number];
export type Realm = "manga" | "anime" | "games";
export const realmCenters: Record<Realm, number> = {
  manga: -12,
  anime: 0,
  games: 12,
};
export const realmOrder: Realm[] = ["manga", "anime", "games"];
export const cameraDirection = (yaw: number, pitch: number): Vec3 => [
  Math.sin(yaw) * Math.cos(pitch),
  Math.sin(pitch),
  -Math.cos(yaw) * Math.cos(pitch),
];
export function viewMatrix(eye: Vec3, target: Vec3) {
  const normalize = (v: Vec3): Vec3 => {
    const length = Math.hypot(...v) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const z = normalize([
      eye[0] - target[0],
      eye[1] - target[1],
      eye[2] - target[2],
    ]),
    x = normalize(cross([0, 1, 0], z)),
    y = cross(z, x);
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return new Float32Array([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ]);
}
export function ortho(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
) {
  const m = identity();
  m[0] = 2 / (right - left);
  m[5] = 2 / (top - bottom);
  m[10] = 1 / (near - far);
  m[12] = (left + right) / (left - right);
  m[13] = (bottom + top) / (bottom - top);
  m[14] = near / (near - far);
  return m;
}
export function portalAtRay(origin: Vec3, direction: Vec3): Realm | null {
  if (Math.abs(direction[2]) < 0.0001) return null;
  const t = (-8 - origin[2]) / direction[2];
  if (t <= 0 || t > 65) return null;
  const x = origin[0] + direction[0] * t,
    y = origin[1] + direction[1] * t;
  if (y < 0 || y > 7) return null;
  return (
    realmOrder.find((realm) => Math.abs(x - realmCenters[realm]) < 3.3) ?? null
  );
}
// Small swept steps prevent wheel and touch input from tunnelling through solids.
export function moveCamera(
  position: Vec3,
  dx: number,
  dz: number,
): [number, number, number] {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
  let x = position[0],
    z = position[2];
  const y = position[1];
  const boxes: number[][] = [
    [-6.65, -5.35, -38, -9],
    [5.35, 6.65, -38, -9],
    [-23.9, -20.1, -4.6, 4.6],
  ];
  for (const cx of [-12, 12])
    for (const cz of [2, 9])
      boxes.push([cx - 2.85, cx + 2.85, cz - 2.5, cz + 2.5]);
  for (const cx of [-12, 0, 12]) boxes.push([cx - 3.4, cx + 3.4, -36, -33.8]);
  const inside = (px: number, pz: number) =>
    boxes.some(([a, b, c, d]) => px > a! && px < b! && pz > c! && pz < d!);
  for (let i = 0; i < steps; i++) {
    const nx = Math.max(-23, Math.min(23, x + dx / steps)),
      nz = Math.max(-36, Math.min(13, z + dz / steps));
    if (!inside(nx, z)) x = nx;
    if (!inside(x, nz)) z = nz;
    const columns: [number, number][] = [];
    for (const cx of [-22, -18, -6, 6, 18, 22])
      for (const cz of [-6, 4, 12]) columns.push([cx, cz]);
    for (const cx of [-12, 0, 12]) columns.push([cx - 3.6, -8], [cx + 3.6, -8]);
    for (const [cx, cz] of columns) {
      const vx = x - cx || 0.001,
        vz = z - cz,
        d = Math.hypot(vx, vz);
      if (d < 0.85) {
        x = cx + (vx / d) * 0.85;
        z = cz + (vz / d) * 0.85;
      }
    }
  }
  return [x, y, z];
}
export function nearestRealm(position: Vec3): Realm | null {
  return position[2] < -8
    ? realmOrder.reduce((a, b) =>
        Math.abs(position[0] - realmCenters[a]) <
        Math.abs(position[0] - realmCenters[b])
          ? a
          : b,
      )
    : null;
}
