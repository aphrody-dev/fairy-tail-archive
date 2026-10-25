# Une expérience Fairy Tail

L’accueil et la galerie sont réunis dans `packages/experience`. L’entrée utilisateur unique est [localhost:3000](http://127.0.0.1:3000/). Le port historique 4173 redirige vers cette origine ; il ne lance plus de vitrine indépendante. Les deux anciennes entrées de code sont des montages minces du même composant `Experience`, et les anciens composants de galerie ne sont que des réexports.

## Parcours réunis

| Icône / fonction | Comportement |
|---|---|
| Scènes WebGPU | Scènes issues des manifests : textures, masques, plans en perspective, pause, zoom, réinitialisation et navigation clavier. |
| Explorer | Sources officielles et communautaires du catalogue généré, langues originales et mosaïque de visuels. |
| Vidéos et anime | Lecteur intégré existant : embeds publics, aperçu MP4 local, provenance et liens diffuseurs. |
| Lire le manga | Extrait public disponible, douze pages cachées, miniatures, pagination et vue à taille d’origine. |
| Jeux | Visuels et références des sources de jeux présentes dans le catalogue. |
| Bibliothèque | Publications, catalogue anime, wikis, recherche et favoris persistants dans l’origine commune. |
| Séries et arcs | Dix fiches VF/VOSTFR, parcours paginé des entrées d’épisodes et 71 arcs communautaires, avec liens et provenance. Les fiches ne sont pas présentées comme des vidéos acquises. |
| Recherche globale | `/search` sur le corpus partagé et `/ask` pour les réponses extractives avec citations ; filtre de langue alimenté par `/library`. |
| Provenance | Métadonnées de la scène ou du visuel actuellement affiché, sans réutiliser celles d’un ancien extrait. |

Les parcours restent sur la même page. Les images et logos viennent du catalogue observé. Le logo général est celui relevé sur la page officielle TV Tokyo W03 ; le logo d’un éditeur ou d’un jeu n’est plus utilisé comme identité générale. L’ancien accueil textuel, son slogan et son cercle décoratif ne sont plus dans le bundle exécuté.

## Propriétaires et rendu

`packages/gpu` reste l’unique renderer WebGPU. La galerie consomme `GPUSurface` ; les scènes multicouches réutilisent `SceneCanvas` et l’adaptateur déjà vérifié de l’accueil. Les SVG mesurés des scènes sont décodés avant transfert GPU ; leur provenance reste conservée. Le proxy `/references/:sourceId/:index` est extrait dans `packages/official-sources/asset-response.ts` et branché par le propriétaire du backend. Il n’accepte que les assets du catalogue et applique un budget de réponse.

Le shell utilise Tailwind CSS et Base UI. Les lecteurs vidéo et les fenêtres natives existants sont réutilisés avec une présentation commune. Les composants accessibles restent en DOM ; la composition des scènes et de la galerie utilise WebGPU. La vue d’image de référence et le repli explicite en cas d’indisponibilité GPU restent présents.

## Validation

- Build unique de l’accueil réussi ; typage ciblé : 707 fichiers sans erreur ; lint ciblé sans problème.
- Douze tests ciblés passent, 69 assertions : matrices GPU, collecte/provenance et construction des scènes.
- Navigateur à 1280 × 720 : passage galerie → scène → vidéo → recherche → manga sans changer d’origine.
- Galerie : canvas WebGPU prêt. Scène : trois plans, un masque et deux SVG rasterisés ; pause et changement de scène vérifiés.
- Lecteur vidéo : `/streams/88/file`, `readyState=4`, durée observée 37,930667 s, lecture initialement en pause.
- Recherche : question « Qui est Natsu ? », réponse rendue avec lien de citation vers le document indexé.
- Manga : douze pages, puis retour aux scènes sans sélecteur ni métadonnées résiduelles de l’extrait.
- Bibliothèque anime : dix fiches ; pagination vérifiée de 1–50 à 51–100 sur les 328 entrées d’une fiche ; 71 arcs présents.
- Proxy source : GET 200, HEAD 200 sans corps, requête conditionnelle 304. Ancienne adresse : 302 vers l’origine unique.

La revue adversariale a identifié le mélange des métadonnées d’extrait et de scène ; les contrôles et la provenance donnent maintenant priorité à la scène active. Le focus des fenêtres natives est restitué à leur déclencheur. La matrice complète de navigateurs et les pertes physiques de périphérique GPU ne sont pas revendiquées comme testées.

## Mise à jour : monde en volume

L’accueil ouvre maintenant le monde explorable de `packages/gpu/WorldRenderer.ts`, intégré dans `packages/experience/WorldSurface.tsx`. Ce moteur est distinct du visualiseur de fichier et des scènes multicouches : géométrie volumétrique, carte d’ombres, contours, profondeur et marche libre. Les icônes anime, manga et jeux conduisent aux ailes correspondantes ; les lecteurs restent accessibles depuis les commandes de l’exploration. L’icône de couches conserve l’accès aux scènes antérieures. Voir [world-exploration.md](world-exploration.md) pour la provenance, les limites de fidélité et le protocole de vérification.
