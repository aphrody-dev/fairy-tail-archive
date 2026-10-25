import { test, expect } from "bun:test";
import {
  fitPlane,
  identity,
  model,
  multiply,
  perspective,
} from "../packages/gpu/math";
test("WebGPU perspective maps near to zero and far to one", () => {
  const near = 0.1,
    far = 100,
    p = perspective(16 / 9, near, far);
  const depth = (z: number) => (p[10]! * z + p[14]!) / -z;
  expect(Math.abs(depth(-near)) < 0.000001).toBe(true);
  expect(Math.abs(depth(-far) - 1) < 0.000001).toBe(true);
});
test("world transform keeps source aspect and translation with identity camera", () => {
  const m = model(0.5, -0.25, -3.2, 2, 3);
  const combined = multiply(identity(), m);
  expect(Array.from(combined)).toEqual(Array.from(m));
  expect(combined[0]).toBe(1);
  expect(combined[5]).toBe(1.5);
  expect(combined[12]).toBe(0.5);
  expect(combined[13]).toBe(-0.25);
});
test("contain and cover respect image aspect while meeting opposite bounds", () => {
  const image = 0.7,
    viewport = 16 / 9,
    distance = 3.2;
  const contain = fitPlane(image, viewport, distance),
    cover = fitPlane(image, viewport, distance, true);
  expect(Math.abs(contain.width / contain.height - image) < 0.000001).toBe(
    true,
  );
  expect(Math.abs(cover.width / cover.height - image) < 0.000001).toBe(true);
  expect(cover.width >= contain.width && cover.height >= contain.height).toBe(
    true,
  );
});
