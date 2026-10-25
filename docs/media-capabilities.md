# Conversion média native qualifiée

Qualification locale du runtime Aphrody `169d8c5ea17b2b55a0582c475adc7123118b9623` : `Bun.Video.available` et `Bun.Video.prototype.remux` sont disponibles. `hls` et `transcode` sont absents. Les capacités détectées sont exposées par `mediaCapabilities()` ; elles ne prouvent pas une lecture navigateur.

## API du projet

`planMediaConversion(archive, episodeId, options)` vérifie une vidéo **déjà enregistrée** dans `episodes`, son chemin réel sous `mediaRoot` (défaut `data/media`), sa signature MP4, son SHA-256 et ses métadonnées natives. Aucune URL distante n'est acceptée. Les limites par défaut sont 16 Mio en entrée, 32 Mio en sortie, 120 secondes et 3 600 images ; les plafonds configurables sont respectivement 64 Mio, 128 Mio, 600 secondes et 18 000 images. La cadence reste rationnelle.

`executeMediaConversion(archive, episodeId, options)` exécute uniquement `{operation:'remux', format:'mp4'}` via `Bun.Video.remux`. Ce remux copie les unités encodées : il ne réencode pas, ne compresse pas et ne crée pas de piste ou d'épisode. La sortie déterministe se trouve dans `data/conversions/<source-sha256>-remux.mp4`, avec un reçu JSON contenant les empreintes, les métadonnées, la version du runtime et la provenance. Le scope promotionnel du MP4 Netflix est conservé lorsqu'il existe dans `stream_local_assets`.

Une sortie existante avec reçu valide est réutilisée après vérification de son empreinte. Une sortie différente ou sans reçu n'est pas écrasée. L'exécution vérifie taille, signature, nombre d'images, dimensions, codec et cadence de la sortie. Les tests décodent également toutes les images de la petite fixture avant/après et comparent leurs empreintes.

Le moteur ne propose pas d'annulation ni de quota d'écriture pour `remux`. Le projet borne l'entrée, exige une marge de conteneur de 1 Mio dans le budget de sortie et contrôle la taille finale ; cette dernière vérification ne constitue pas un quota du système de fichiers pendant l'appel natif. Aucun encodeur externe ni processus FFmpeg n'est ajouté.

La qualification porte sur la fixture silencieuse H264 de 15 images. Le MP4 promotionnel Netflix H264 Main + AAC réel est refusé par le moteur avec `remux cannot preserve this track configuration`. Cette erreur native est conservée ; le support MP4 ne signifie pas que toutes les configurations de pistes sont compatibles. Aucun réencodage de secours n'est effectué.

## HLS et conteneurs : documentation et binaire diffèrent

Les sources actuelles `C:/bun/docs/runtime/video.mdx`, `C:/bun/packages/bun-types/bun.d.ts` et `C:/bun/src/runtime/video/Video.rs` documentent `video.hls(directory,{segmentSeconds})` : CMAF `init.mp4`, segments `.m4s` et playlist VOD, sans réencodage, découpe aux images clés. **Cette méthode n'existe pas dans le binaire qualifié ci-dessus.** Le projet refuse donc son exécution ; lire une playlist avec Hls.js reste une capacité distincte de la fabriquer.

La documentation récente décrit aussi le remux MP4/MOV/Matroska/WebM. Un probe natif sur la fixture a produit des octets MP4 (`ftyp`, métadonnée `MPEG-4`) pour les quatre extensions `.mp4`, `.mov`, `.mkv` et `.webm` avec le runtime installé. Le projet n'active que `.mp4` : une extension ne prouve pas un changement de conteneur. Aucun transcodage H264/AV1/VP9 n'est annoncé.

## Réutilisation du modèle Shenron

Lecture seule du propriétaire `C:/src/shenron/packages/media/src/episode-video-delivery.ts` et de `C:/bun/packages/bun-video/docs/shenron-episode-assets.md` : la livraison sépare source `{url,sha256,bytes}`, dimensions/durée exactes, PNG horodatés et sous-titres externes. Le projet conserve cette séparation de provenance. Il n'invente ni URL publiée, ni ID d'épisode Shenron, ni nouveau sous-titre à partir de texte incrusté. Aucune ingestion ou publication Shenron n'est effectuée.
