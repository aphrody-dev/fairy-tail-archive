export const identity = () =>
  new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export function multiply(a: Float32Array, b: Float32Array) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++)
        out[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return out;
}
/** Right-handed perspective with WebGPU's 0..1 depth range. */
export function perspective(
  aspect: number,
  near = 0.1,
  far = 100,
  fov = Math.PI / 4,
) {
  const f = 1 / Math.tan(fov / 2),
    range = 1 / (near - far);
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
    far * range,
    -1,
    0,
    0,
    near * far * range,
    0,
  ]);
}
export function model(
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  rx = 0,
  ry = 0,
  rz = 0,
) {
  const cx = Math.cos(rx),
    sx = Math.sin(rx),
    cy = Math.cos(ry),
    sy = Math.sin(ry);
  const translate = identity();
  translate[12] = x;
  translate[13] = y;
  translate[14] = z;
  const rotX = new Float32Array([
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
  const rotY = new Float32Array([
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
  const scale = identity();
  const cz = Math.cos(rz),
    sz = Math.sin(rz);
  const rotZ = new Float32Array([
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
  scale[0] = width / 2;
  scale[5] = height / 2;
  return multiply(
    translate,
    multiply(rotZ, multiply(rotY, multiply(rotX, scale))),
  );
}
export function fitPlane(
  imageAspect: number,
  viewportAspect: number,
  distance: number,
  cover = false,
) {
  const h = 2 * Math.tan(Math.PI / 8) * distance,
    w = h * viewportAspect;
  const height = cover
    ? Math.max(h, w / imageAspect)
    : Math.min(h, w / imageAspect);
  return { width: height * imageAspect, height };
}
