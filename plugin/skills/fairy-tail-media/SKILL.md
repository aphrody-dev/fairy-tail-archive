---
name: fairy-tail-media
description: Consulter les catalogues Fairy Tail de vidéos, épisodes et captures, vérifier leurs origines et distinguer métadonnées publiques, miniatures et images extraites de fichiers locaux.
---

# Catalogues et captures Fairy Tail

`fairy_tail_library` présente les volumes manga, pages et assets de leurs extraits,
ainsi que les animes et documents wiki. Conserver l’ISBN papier et l’EAN de l’extrait
séparément. Les pages EPUB exposées par une liseuse sont un extrait tant qu’aucune
source n’établit un volume complet ; ne pas transformer une miniature ou un EPUB
partiel en tome intégral. Les liens CDN locaux servent seulement les octets acquis.

Pour le catalogue anime indexé, appeler le même tool `fairy_tail_library` avec
`kind: "anime_works"` (liste paginée), `kind: "anime_work"` et `work_id`
(24 caractères hexadécimaux provenant de la liste), ou
`kind: "anime_catalog_status"` (couverture et écarts constatés).
`kind: "anime_arcs"` lit les arcs sourcés avec `lang: "fr" | "en" | "ja"`.
Utiliser `limit` 1..100 et `offset` 0..100000 pour les arcs ; les autres listes
acceptent un offset jusqu’à 1000000. Le filtre lang concerne les arcs, pas les œuvres.
Les arcs narratifs et leurs numérotations sourcées restent distincts des saisons
fournisseur. Conserver les indications de plages manga, d’écarts entre comptes,
de numérotations distinctes et de nommage communautaire. Une fiche catalogue
ou une liste d’épisodes ne prouve aucune acquisition vidéo ni exhaustivité.
Ces actions ne collectent rien et ne créent aucune table.

Consulter `fairy_tail_media` pour les fiches Netflix et YouTube, et
`fairy_tail_fancaps` pour le catalogue de captures et le cache local. Utiliser
`fairy_tail_coverage` pour les volumes réellement indexés et
`fairy_tail_native_status` pour les capacités déclarées du runtime.

Une fiche Netflix publique ne prouve pas l'accès au flux, aux saisons entières
ou aux fichiers téléchargés. Une vidéo YouTube cataloguée ne prouve pas que son
média ou ses sous-titres ont été acquis. Décrire les langues marquées dans les
titres VF/VOSTFR comme des indications de titre lorsqu'aucune piste n'a été
analysée.

Pour Fancaps, conserver le numéro d'épisode, l'URL de page, le CDN observé et la
variante `thumbnail` ou originale réellement disponible. Une miniature peut être
servie en WebP même si son URL source se termine en `.jpg`. Citer le type et les
dimensions mesurés ; ne pas fabriquer d'URL d'image originale.

Les captures d'un site et les images extraites par `Bun.Video` sont deux jeux de
données distincts. « Image par image » décrit le pipeline des fichiers locaux
qualifiés, pas une garantie d'exhaustivité de toutes les saisons du Web.
Une route CDN locale sert le cache existant ; elle ne déclenche pas de requête
arbitraire à distance. Les outils MCP de ce paquet sont en lecture seule.

Voir les [outils et leur périmètre](../../references/tools.md). Les imports et
collectes se lancent avec les commandes du projet lorsque la demande les couvre.
