import { test, expect } from "bun:test";
import {
  cameraDirection,
  moveCamera,
  portalAtRay,
  nearestRealm,
  viewMatrix,
  ortho,
} from "../packages/gpu/world-math";
import { buildWorld, type WorldExhibit } from "../packages/gpu/world-geometry";
test("a world camera maps its own eye to the origin", () => {
  const eye = [3, 2.8, 7] as const,
    m = viewMatrix(eye, [0, 2.8, -2]);
  for (let row = 0; row < 3; row++)
    expect(
      Math.abs(
        m[row]! * eye[0] +
          m[4 + row]! * eye[1] +
          m[8 + row]! * eye[2] +
          m[12 + row]!,
      ),
    ).toBeLessThan(0.00001);
  const o = ortho(-38, 38, -38, 38, 0.1, 120);
  expect(-0.1 * o[10]! + o[14]!).toBeCloseTo(0);
  expect(-120 * o[10]! + o[14]!).toBeCloseTo(1);
});
test("portal selection follows the ray and rejects behind-camera targets", () => {
  expect(portalAtRay([0, 2.8, 12], cameraDirection(0, 0))).toBe("anime");
  expect(portalAtRay([-12, 2.8, 12], cameraDirection(0, 0))).toBe("manga");
  expect(portalAtRay([12, 2.8, 12], cameraDirection(0, 0))).toBe("games");
  expect(portalAtRay([0, 2.8, 12], [0, 0, 1])).toBeNull();
  expect(portalAtRay([0, 2.8, 12], [0, 1, 0])).toBeNull();
  expect(nearestRealm([-12, 2.8, -15])).toBe("manga");
  expect(nearestRealm([0, 2.8, 12])).toBeNull();
});
test("large wheel steps cannot tunnel through partitions, columns, or furniture", () => {
  expect(moveCamera([-6.7, 2.8, -20], 2, 0)[0]).toBeLessThanOrEqual(-6.65);
  expect(moveCamera([-5, 2.8, -20], -2, 0)[0]).toBeGreaterThanOrEqual(-5.35);
  const pillar = moveCamera([-8, 2.8, 4], 4, 0);
  expect(Math.hypot(pillar[0] + 6, pillar[2] - 4)).toBeGreaterThanOrEqual(
    0.8499,
  );
  expect(moveCamera([-12, 2.8, 6], 0, -8)[2]).toBeGreaterThanOrEqual(4.5);
  expect(moveCamera([0, 2.8, 12], 0, -20)[2]).toBeCloseTo(-8);
});
test("a volumetric world retains artwork aspect, source identity and valid vertex data", () => {
  const assets: WorldExhibit[] = ["manga", "anime", "games"].map(
    (realm, i) => ({
      id: String(i),
      realm: realm as WorldExhibit["realm"],
      url: "/test",
      originalUrl: "https://example.org/art",
      sourceUrl: "https://example.org/source",
      title: "Test fixture",
      aspect: 0.67,
      sourceClass: "official",
    }),
  );
  const mesh = buildWorld(assets);
  expect(mesh.vertexCount).toBeGreaterThan(40000);
  expect(mesh.vertices.length).toBe(mesh.vertexCount * 14);
  expect(mesh.vertices.every(Number.isFinite)).toBe(true);
  expect(mesh.positions.map((p) => p.position[0])).toEqual([-12, 0, 12]);
  for (const p of mesh.positions) {
    expect(p.width / p.height).toBeCloseTo(0.67);
    expect(p.asset).toBe(assets[p.slot]);
  }
});
