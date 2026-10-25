# @fairy/tailwindcss

Fondations techniques Tailwind CSS v4 et styles des primitives `@fairy/ui`.

```css
@import "@fairy/tailwindcss";
@import "../../packages/official-sources/generated/themes.css";
@source "./src";
```

Les utilities (`bg-canvas`, `text-ink`, `font-sans`, etc.) utilisent `@theme inline`
pour référencer des propriétés CSS runtime. Les valeurs de source sont générées,
jamais recopiées dans un thème manga/anime/jeux alternatif.

`tokens.css` ne fournit que des fallbacks système neutres : Canvas, CanvasText,
ButtonBorder, Highlight, system-ui. `fonts.css` ne charge aucune font choisie à la
main. Les déclarations font-family observées restent dans le catalogue et le CSS
généré ; un nom de font ne garantit pas qu’elle soit installée ou chargée.

`components.css` fournit les contrôles, états disabled/loading/checked/selected,
focus visible et réduction des mouvements. La visionneuse donne toute la place
aux véritables images : pas de recadrage, filtre gris, retouche ou effet de
style supposé officiel. Son chrome sombre est une interface neutre du navigateur,
distincte des observations CSS des sites.

Le CSS observé n’est pas un calcul complet de la cascade ni une reconstruction
pixel parfaite d’un site entier. La fidélité du viewer porte sur le fichier
source affiché à son ratio d’origine, avec ses dimensions et sa provenance.
