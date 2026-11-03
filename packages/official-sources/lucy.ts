import catalog from "./generated/view-catalog.json";

/** Curated references, not a claim that these assets depict RE:FANTASIA. */
export function lucyReferences() {
  const selected = new Set([
    "https://gaga.ne.jp/FT.DC/common/img/top_animation/lucy.png",
    "https://www.fairytailgame.com/common/img/chara/img_lucy.png",
    "https://www.fairytailgame.com/common/img/chara/gallery_lucy01.jpg",
    "https://www.fairytailgame.com/common/img/chara/gallery_lucy02.jpg",
  ]);
  const images = catalog.sources.flatMap((source) =>
    source.images.flatMap((image, index) =>
      selected.has(image.url)
        ? [
            {
              sourceId: source.id,
              assetIndex: index,
              imageUrl: image.url,
              sourceUrl: image.sourceUrl,
              localUrl: `/references/${source.id}/${index}`,
              observedAt: source.observedAt,
              work:
                source.id === "W12" ? "Dragon Cry" : "Fairy Tail (jeu vidéo)",
              rights: "Conditions de réutilisation non vérifiées",
            },
          ]
        : [],
    ),
  );
  return {
    id: "lucy-heartfilia",
    name: "Lucy Heartfilia",
    requestedWork: "FAIRY TAIL RE:FANTASIA",
    updatedAt: "2026-11-03",
    sources: [
      {
        url: "https://sp.shonenmagazine.com/fairytail20th/news/9/",
        language: "ja",
        kind: "official",
        work: "FAIRY TAIL RE:FANTASIA",
        note: "Annonce du récit et du volume ; pas une fiche de personnage.",
      },
      {
        url: "https://s.magazinepocket.com/ldg?d=1&e=441933&t=45",
        language: "ja",
        kind: "official",
        work: "FAIRY TAIL RE:FANTASIA",
        note: "Page officielle du premier chapitre ; images non acquises par cette API.",
      },
      {
        url: "https://bigsolo.org/manga/fairy-tail-refantasia/1/3",
        language: "fr",
        kind: "user-provided-third-party-link",
        work: "FAIRY TAIL RE:FANTASIA",
        note: "Page de lecture fournie par l'utilisateur ; provenance éditoriale, autorisation et disponibilité non vérifiées.",
      },
      {
        url: "https://cdnic.bigsolo.org/files/0cb7d15c2062.png",
        language: "fr",
        kind: "user-provided-image-reference",
        work: "FAIRY TAIL RE:FANTASIA",
        note: "Adresse d'image fournie par l'utilisateur ; elle n'est ni copiée ni servie par cette API.",
      },
      {
        url: "https://www.fairytail100yq.com/character/lucy-heartfilia.html",
        language: "ja",
        kind: "official",
        work: "FAIRY TAIL 100 YEARS QUEST",
        note: "Fiche de Lucy dans une autre œuvre ; constellationniste et romancière débutante.",
      },
      {
        url: "https://www.graniph.com/story/story-detail/83",
        language: "ja",
        kind: "official-interview",
        work: "FAIRY TAIL",
        note: "Mashima décrit l'intérêt de Lucy pour la mode et une inspiration gyaru de l'ère Heisei.",
      },
    ],
    images,
    limitations: [
      "Les images listées proviennent d'autres œuvres ; elles ne prouvent pas une tenue RE:FANTASIA.",
      "Leur présence au catalogue ne garantit ni disponibilité actuelle ni autorisation de redistribution.",
      "Les médias fournis par l'utilisateur et leurs dérivés restent locaux et ne sont pas servis par cette route.",
    ],
  };
}
