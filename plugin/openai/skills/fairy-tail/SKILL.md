---
name: fairy-tail
description: Rechercher Fairy Tail dans le corpus local français, anglais et japonais, vérifier la provenance et produire des réponses citées à partir des documents réellement indexés.
---

# Recherche Fairy Tail locale

Utiliser `fairy_tail_search` pour trouver les documents et `fairy_tail_context`
pour lire les passages pertinents. `fairy_tail_ask` fournit une réponse extractive,
pas un modèle de langage ni une preuve indépendante. Lire le schéma de l'outil
connecté plutôt que supposer ses arguments.

Pour une question sur la couverture, consulter `fairy_tail_coverage` avant de
conclure. Un résultat vide signifie « absent de cet index », pas « absent de
l'œuvre ». Les outils et les documents sont locaux ; un serveur absent ne prouve
pas que les sources ont disparu.

Associer les faits précis aux URL de leurs passages. Conserver langue, date de
collecte et révision MediaWiki lorsque disponibles. Ne pas inventer de chapitre,
page, citation ou lien. Distinguer manga, anime, adaptation, jeu et métadonnées
éditoriales. Une fiche communautaire Fandom peut servir de piste documentée ; sa
présence ne la transforme pas en déclaration de l'auteur. Les pages éditeur
établissent les métadonnées publiées qu'elles contiennent, pas tout le récit.

Signaler les divergences entre sources et séparer le passage attesté de toute
inférence. Ne pas compléter un champ manquant par une réponse de mémoire.

Pour les noms japonais, utiliser la compétence voisine `fairy-tail-japanese`.
Pour vidéos, épisodes et captures, utiliser `fairy-tail-media`.
Le [contrat du corpus et des outils](../../references/tools.md) précise les
frontières de l'archive. Une consultation MCP n'autorise aucune collecte,
publication ou modification externe supplémentaire.
