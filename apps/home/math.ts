export type Vec3 = readonly [number, number, number];
export const identity = () =>
  new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export function multiply(a: Float32Array, b: Float32Array) {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++)
        result[column * 4 + row]! += a[k * 4 + row]! * b[column * 4 + k]!;
  return result;
}
export function perspective(
  fov: number,
  aspect: number,
  near: number,
  far: number,
) {
  const f = 1 / Math.tan((fov * Math.PI) / 360),
    n = 1 / (near - far);
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) * n,
    -1,
    0,
    0,
    2 * far * near * n,
    0,
  ]);
}
function unit(vector: Vec3): [number, number, number] {
  const length = Math.hypot(...vector) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function lookAt(eye: Vec3, target: Vec3) {
  const z = unit([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]),
    x = unit(cross([0, 1, 0], z)),
    y = cross(z, x);
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
export function model(
  position: Vec3,
  rotation: Vec3,
  width: number,
  height: number,
) {
  const [x, y, z] = rotation,
    cx = Math.cos(x),
    sx = Math.sin(x),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cz = Math.cos(z),
    sz = Math.sin(z);
  const translation = identity();
  translation[12] = position[0];
  translation[13] = position[1];
  translation[14] = position[2];
  const rx = new Float32Array([
    1,
    0,
    0,
    0,
    0,
    cx,
    sx,
    0,
    0,
    -sx,
    cx,
    0,
    0,
    0,
    0,
    1,
  ]);
  const ry = new Float32Array([
    cy,
    0,
    -sy,
    0,
    0,
    1,
    0,
    0,
    sy,
    0,
    cy,
    0,
    0,
    0,
    0,
    1,
  ]);
  const rz = new Float32Array([
    cz,
    sz,
    0,
    0,
    -sz,
    cz,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
  ]);
  const scale = identity();
  scale[0] = width;
  scale[5] = height;
  return multiply(translation, multiply(rz, multiply(ry, multiply(rx, scale))));
}
