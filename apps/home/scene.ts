export type SceneAsset = {
  url: string;
  mime: string;
  sha256: string;
  width: number;
  height: number;
};
export type Scene = {
  id: string;
  title: string;
  reconstruction: "layered-2.5d";
  source: {
    kind: "manga" | "anime" | "frame";
    id: string;
    url: string;
    originalUrl: string | null;
    sha256: string;
    width: number;
    height: number;
    scope: "preview" | "thumbnail" | "local-frame";
  };
  width: number;
  height: number;
  aspect: number;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
    near: number;
    far: number;
  };
  assets: {
    texture: SceneAsset;
    preview: SceneAsset;
    focus: SceneAsset;
    contours: SceneAsset;
    mask: SceneAsset;
  };
  layers: {
    id: string;
    geometry: "plane";
    width: number;
    height: number;
    position: [number, number, number];
    rotation: [number, number, number];
    texture: string;
    mask?: string;
    opacity: number;
  }[];
  analysis: {
    engine: string;
    neuralDepth: false;
    edgeSegments: number;
    maskMethod: string;
  };
};

export function sceneAsset(url: string, scene: Scene): string {
  const address = new URL(url, window.location.origin);
  if (
    address.origin !== window.location.origin ||
    !address.pathname.startsWith(
      `/scenes/${encodeURIComponent(scene.id)}/assets/`,
    )
  )
    throw new Error(
      "La scène contient une texture hors de son répertoire local.",
    );
  return address.href;
}
export async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    let message = `Le service répond HTTP ${response.status}.`;
    try {
      const body = await response.json();
      if (typeof body.error === "string") message = body.error;
    } catch {
      /* preserve status */
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}
