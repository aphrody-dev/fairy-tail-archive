# Fairy WebGPU

Moteur partagé natif WebGPU/WGSL, sans dépendance d’exécution et sans renderer WebGL. L’accueil et la visionneuse consomment le même propriétaire.

```ts
const renderer = await WebGPURenderer.create(canvas, {
  onStatus: (status, message) => {},
  maxDpr: 1.5,
  transparent: false,
});
await renderer.load({
  id: source.id,
  layers: [{ id: "art", url: localVerifiedAssetUrl, fit: "contain" }],
  particles: true,
});
// setPaused, setZoom, setPointer, reset, dispose
```

Le rendu utilise une projection perspective avec profondeur WebGPU 0..1, textures RGBA, masques alpha, trois axes de rotation et mélange prémultiplié. Le changement de scène effectue une transition de 650 ms. Les 128 particules ambiantes sont calculées par un compute shader puis dessinées par instances ; leur couleur vient de la texture source. Elles sont décoratives et ne sont pas des éléments prétendument extraits de l’œuvre.

Le canvas suit sa taille CSS avec DPR plafonné à 1,5 et budget de 2,8 millions de pixels. Les textures sont limitées à 4096 pixels par axe et 16 Mo par fichier ; le proxy de références de la visionneuse applique une limite supplémentaire de 8 Mo. Le moteur libère buffers et textures, annule les chargements obsolètes, suspend le rendu hors écran/en onglet masqué et respecte `prefers-reduced-motion`. Une perte de périphérique déclenche une nouvelle initialisation et recharge la dernière scène demandée.

Les textures doivent être servies depuis l’origine locale. La visionneuse utilise un proxy limité aux assets déjà présents dans le catalogue de provenance. L’accueil utilise ses assets de scènes ; les SVG sont décodés en PNG par son adaptateur avant transfert GPU, avec conservation de leur provenance. Une image DOM est conservée si WebGPU ne peut pas fonctionner ; aucun repli WebGL n’est utilisé. La vue à taille d’origine de la visionneuse reste disponible comme image de référence.

Des images projetées sur des plans restent des scènes 2.5D : le moteur ne prétend pas reconstruire la géométrie des personnages. Une véritable géométrie 3D exige des assets adaptés, distincts des captures et pages manga.

Validation du 25 octobre 2026 : rendu réel dans le navigateur à 1280 × 720, canvas 1920 × 1080, pipelines render/compute/particles, plus de 2400 images soumises, aucune erreur GPU relevée dans le parcours. Ce compteur ne constitue pas une mesure de FPS. Trois tests de matrices/cadrage complètent la vérification visuelle. Les scénarios de perte physique du GPU et tous les appareils mobiles n’ont pas été reproduits.

Références primaires consultées : [WebGPU W3C](https://gpuweb.github.io/gpuweb/), [initialisation et perte du périphérique](https://gpuweb.github.io/gpuweb/explainer/), [API navigateur](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API). Context7 a également été consulté sur `/gpuweb/gpuweb`.
