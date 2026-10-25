# @fairy/ui

Primitives React sur Base UI 1.9.0 et styles Tailwind v4. Le contenu de la
visionneuse vient de `packages/official-sources/generated/view-catalog.json` et
de l’API locale existante ; aucun slogan, titre de contenu, image ou thème
Fairy Tail n’est codé manuellement dans ce package.

`SourceThemeProvider` applique `data-ft-source` et conserve cette identité jusque
dans les portails Base UI. Les thèmes sont importés séparément depuis
`packages/official-sources/generated/themes.css`. Les valeurs absentes gardent
les couleurs système et la typographie système, sans palette interprétée.

Exports : Button, Badge, Card/Body/Title/Description, Input, Textarea, Checkbox,
Switch, Select, Tabs, Dialog, Accordion, Tooltip, Progress, Skeleton, Separator,
Breadcrumb, SourceLogo, SourceCard, SourceThemeProvider et useSourceTheme.
`SourceCard` prend un `OfficialSource` généré et distingue official, wiki,
streaming et scan. `sourceCatalog`, `sourceAssets` et `observedFontEvidence` sont
des dérivations du catalogue généré, pas un manifeste d’assets écrit à la main.

Les images découvertes conservent leur URL et leur texte alternatif natif.
Leur présence dans un HTML ne prouve ni disponibilité actuelle ni licence de
redistribution. Les fonts propriétaires ne sont pas téléchargées. Aucune font
alternative n’est chargée en la présentant comme fidèle à l’œuvre.

La vitrine `apps/design-system` est une visionneuse immersive : source et langue
issues du catalogue, fichier intact en contain, taille originale, miniatures,
contrôles masquables, plein écran si autorisé, panneau de provenance et lecteur
des extraits publics déjà mis en cache par l’API. Les titres et descriptions
restent dans leur langue native. Les libellés de contrôles sont ceux de l’app.

L’ancien prototype interprétatif (slogans, palettes manga/anime/jeux arbitraires,
Bangers/Georgia, bulles et image utilisateur) a été retiré. Il ne constitue pas
la version livrée.

Commandes : `bun run design:build`, `bun run design:dev`,
`bun check -p packages/ui --threads=2`, `bun check -p apps/design-system --threads=2`.
Le serveur local écoute `http://127.0.0.1:4173/`. Son proxy `/api` autorise
uniquement les lectures des volumes, pages et images manga de l’API existante
sur 127.0.0.1:3000 ; aucun téléchargement distant additionnel n’est déclenché.
