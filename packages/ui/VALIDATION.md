# Validation de la version source-first

La version livrée remplace le prototype de design interprétatif. Les précédents
scores de contraste de palettes manuelles ne s’appliquent plus et sont retirés.

Vérifications : typecheck natif Bun de `packages/ui` et `apps/design-system`,
lint et format natifs, compilation Bun + plugin Tailwind Aphrody.

Sources : catalogue compact généré ; thèmes générés depuis les déclarations
observées retenues par le pipeline. Les absences restent des valeurs système.

Lecteur : les volumes d’extraits sont découverts dans l’API locale et seuls les
assets avec `cacheState=cached` sont affichés. L’empreinte du fichier manga vient
de cet asset, jamais du document HTML de la source précédemment sélectionnée.
Les URLs de fichier, source éditeur et EPUB restent distinctes dans la provenance.

Les contrôles Base UI assurent les interactions clavier et le focus des popups.
La vérification navigateur effective est rapportée par le parent ; aucune largeur
ou certification d’accessibilité non réellement testée n’est revendiquée ici.
