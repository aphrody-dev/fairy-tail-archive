# Contrat local Fairy Tail

Le serveur MCP est exécuté par Bun depuis `apps/mcp/main.ts` du dépôt. Il lit
l'archive SQLite sélectionnée par `ARCHIVE_DB`. Les outils locaux sont :

| Outil                      | Usage                                                                  |
| -------------------------- | ---------------------------------------------------------------------- |
| `fairy_tail_search`        | Recherche de documents et passages indexés                             |
| `fairy_tail_context`       | Contexte et provenance des passages trouvés                            |
| `fairy_tail_ask`           | Réponse extractive Python avec références                              |
| `fairy_tail_coverage`      | Couverture réelle de l'archive                                         |
| `fairy_tail_books`         | Métadonnées des livres et éditions indexées                            |
| `fairy_tail_media`         | Catalogues publics vidéo et liens locaux disponibles                   |
| `fairy_tail_fancaps`       | Catalogue de captures Fancaps et état du cache                         |
| `fairy_tail_native_status` | Capacités natives Bun/Aphrody déclarées                                |
| `fairy_tail_library`       | Bibliothèque manga/anime/wiki, pages d’extrait et disponibilité réelle |

Le client peut normaliser leur nom. Lire `tools/list` et les schémas connectés.
Une capacité annoncée n'est pas la preuve d'un modèle chargé, d'un codec
compatible ou d'une collecte terminée.

Les sources FR/EN/JA conservent leur provenance. Les wikis communautaires,
éditeurs, catalogues vidéo et captures ne jouent pas le même rôle de preuve.
Les statistiques décrivent le corpus présent, jamais l'intégralité du Web.

Ce paquet ne contient pas de données de fiction embarquées ou de lexique
canonique généré. Sans serveur ou corpus, annoncer l'indisponibilité ; ne pas
inventer un mode hors ligne documentaire inexistant.
