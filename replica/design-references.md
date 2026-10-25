# Références visuelles et correction de direction

Mise à jour : 25 octobre 2026. Ce document complète la reconnaissance documentaire avec les deux références explicitement fournies par l’utilisateur pendant la préparation des packages UI.

## Références utilisateur

| ID | Référence | Origine | Utilisation |
|---|---|---|---|
| D01 | Image anime, Mirajane et Gray devant une architecture crème et bleu-vert | Pièce jointe utilisateur `codex-clipboard-e0adf55d-2bc2-40a7-966f-73dc1ebd6480.png` | Référence d’aplats, d’ombres et de palette ; aucune URL CDN officielle n’est déduite de l’image |
| D02 | Planche manga en noir et blanc avec cases, bulles et gouttières noires | Pièce jointe utilisateur `codex-clipboard-88549066-ab89-44ee-bce0-d55a6797a983.png` | Référence de composition et de contraste ; pas une source de police réutilisable ni une preuve de licence d’édition |

## Décisions de design demandées

**Direction remplacée par la demande ultérieure de l’utilisateur :** les interprétations ci-dessous décrivent une étape abandonnée. Elles ne constituent ni un design system officiel ni des tokens à réutiliser. L’interface doit désormais afficher les images sources sans recoloration ni recadrage imposé et consommer les données générées avec leur provenance. Les couleurs et polices manquantes restent indéterminées ; aucun remplacement expressif n’est présenté comme authentique.

Manga : fond blanc et encre noire dominants, gouttières noires épaisses, cases asymétriques, contours nets, bulles blanches détourées et trames légères. Une interface crème à titres Georgia ne représente pas suffisamment cette référence. Les textes d’interface restent lisibles ; le lettering expressif est réservé aux titres et aux accents.

Anime : aplats en couleurs, ombres à arêtes franches, contours sombres et palette inspirée des teintes visibles — crème, bleu-vert, lavande et bleu ciel. Ces couleurs constituent une interprétation du screenshot, pas des tokens officiels extraits d’un guide de marque.

Jeux : conserver une expression distincte fondée sur les références Koei Tecmo, avec hiérarchie des actions et éléments graphiques de guilde. Ne pas appliquer un thème générique identique aux trois médias.

## Provenance des assets et typographies

Le manifeste technique doit distinguer :

1. Logos et visuels distants trouvés sur les pages officielles W01, W02 et W16, avec URL exacte, page source, dimensions connues et date du contrôle.
2. Images fournies par l’utilisateur, référencées comme telles et jamais qualifiées de CDN officiel.
3. Polices déclarées par les sites officiels, avec leur feuille de styles source.
4. Polices choisies en remplacement pour le lettering, explicitement présentées comme alternatives ; ne pas leur attribuer une origine Fairy Tail.

Les sites officiels utilisent notamment des hôtes statiques de première partie. Le terme « CDN » ne doit pas faire croire qu’un service public de redistribution des assets a été identifié. Les fichiers propriétaires de typographie ne doivent pas être incorporés sans licence appropriée.

## Critères de validation

- Les trois thèmes doivent changer la composition et le langage visuel, au-delà d’un simple changement de couleur.
- Les motifs de trame et de vitesse sont décoratifs et ne doivent pas gêner le texte, les états ou le focus.
- Les bulles et cases doivent conserver une lecture cohérente sur écran étroit.
- Les composants Base UI conservent clavier, labels, focus, portails et fermeture par Échap.
- Les logos réels restent proportionnés ; un échec réseau affiche un fallback textuel identifiable.
- Le manifeste de provenance est séparé des choix d’inspiration et des droits de redistribution.

Recherche ui-ux-pro-max : `comic manga panels` n’a donné aucun résultat. Le second essai `comic ink black white` a retourné des styles génériques papier/minimalisme/brutalisme ; aucun n’est retenu comme équivalent vérifié de Fairy Tail. La direction visuelle repose donc sur D01 et D02 ainsi que les sources officielles, avec les règles générales d’accessibilité du skill.
