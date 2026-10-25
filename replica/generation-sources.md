# Génération et provenance

Le registre `sources.csv` contient 81 destinations documentaires. Ce nombre ne signifie pas 81 services actifs ni 81 sites indépendants.

Le package `packages/official-sources` produit `generated/catalog.json` et `generated/themes.css` à partir du registre et des sources wiki déjà configurées dans le crawler. La commande `bun run sources:generate` collecte par défaut dix pages explicites, sans parcours récursif : W01, W02, W11, W16, W20, W24, W53, W54, W79 et wikipedia-en.

La commande `bun run sources:generate --all` tente toutes les entrées éligibles du registre explicite, avec quatre collectes simultanées au maximum. Un lancement ciblé avec `--ids=W46,W47` conserve les observations des autres pages si le registre est inchangé.

Dernier relevé du 25 octobre 2026 : 76 entrées éligibles toutes tentées, 68 pages collectées et huit échecs documentés. W52 et W70 répondent 503, W62 expire, W76 échoue au contrôle du certificat TLS, wikipedia-ja dépasse le budget de réponse, W69, fandom-en et fandom-fr répondent 403. Aucun de ces résultats ne prouve la fermeture du service. Dix références historiques ou secondaires du registre sont exclues du jeu de sources officielles généré. Les wikis ont la classe `wiki`, séparée de `official`. Une page collectée n’implique pas que tous ses assets ont été vérifiés individuellement, ni qu’une page générique redirigée contient encore le contenu attendu.

Les langues et variantes sont conservées telles que déclarées par les pages, y compris leurs éventuelles incohérences avec le registre. Le décodeur respecte le charset HTTP ou HTML, notamment Shift-JIS sur les anciens jeux Nintendo. Aucune traduction de contenu n’est inventée.

`generated/view-catalog.json` est la projection compacte destinée à l’interface ; `generated/catalog.json` garde les observations CSS détaillées. Context7 a été consulté pour vérifier `@theme inline` de Tailwind et la gestion du focus de `Dialog.Popup` de Base UI 1.9.0.

Chaque collecte conserve URL finale, statut HTTP, date, empreinte SHA-256, langue déclarée, sélecteurs de métadonnées et URLs d’images. Les feuilles CSS observées conservent leur URL, empreinte, sélecteurs et conditions. L’analyse est statique : elle ne reconstruit pas la cascade calculée du navigateur et n’autorise donc aucune promesse de reproduction pixel parfaite de l’interface source.

Les thèmes ne retiennent que des déclarations explicites sur html/body/:root, hors conditions. Les couleurs de texte et de fond ne sont appliquées ensemble que si leur contraste mesurable atteint 4,5. Les valeurs manquantes, variables non résolues, gradients et règles conditionnelles ne sont pas devinés. Les autres styles d’interface sont des choix fonctionnels, sans attribution à Fairy Tail.

L’utilisateur autorise également les wikis, pages publiques de streaming et sites de scans comme références. Cette autorisation ne les transforme pas en sources officielles. Leur contenu doit garder sa classe, sa langue et son URL d’origine. Aucun site de scans précis n’a encore été ajouté au registre.

Le monorepo dispose aussi d’un catalogue local de 298 publications Pika et d’un extrait public Hachette/Pika de douze pages, exposés par l’API existante. Ces douze pages sont un aperçu, jamais un volume complet. Les 30 entrées anime indexées sont des métadonnées publiques ; aucun épisode distant acquis n’est revendiqué.
