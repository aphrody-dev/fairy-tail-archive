import catalogData from "../../official-sources/generated/view-catalog.json";
import type { OfficialCatalog } from "../../official-sources/types";

/** Only generated observations; no hand-authored logo URL, text or palette. */
export const sourceCatalog: OfficialCatalog = catalogData as OfficialCatalog;
export const sourceAssets = (sourceId: string) =>
  sourceCatalog.sources.find((source) => source.id === sourceId)?.images ?? [];
export const observedFontEvidence = sourceCatalog.sources.flatMap((source) =>
  source.declarations
    .filter((declaration) => declaration.property === "font-family")
    .map((declaration) => ({ sourceId: source.id, ...declaration })),
);
export type {
  OfficialCatalog,
  OfficialSource,
  SourceAsset,
} from "../../official-sources/types";
