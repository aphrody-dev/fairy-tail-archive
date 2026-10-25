export type ObservedDeclaration = {
  property: string;
  value: string;
  selector: string;
  conditions: string[];
  stylesheetUrl: string;
  contentHash: string;
  line: number | null;
};

export type SourceAsset = {
  url: string;
  alt: string;
  kind: "logo" | "image" | "social";
  sourceUrl: string;
  selector: string;
};

export type SourceStylesheet = {
  url: string;
  status: number | null;
  contentHash: string | null;
  error: string | null;
};

export type OfficialSource = {
  id: string;
  sourceClass: "official" | "wiki" | "streaming" | "scan";
  url: string;
  finalUrl: string | null;
  category: string;
  operator: string;
  language: string | null;
  declaredLanguage: string | null;
  registryEvidence: string;
  registryAvailability: string;
  status: "verified" | "unavailable" | "not_collected";
  httpStatus: number | null;
  observedAt: string | null;
  contentHash: string | null;
  title: string | null;
  description: string | null;
  fieldSelectors: { title: string | null; description: string | null };
  images: SourceAsset[];
  fontStylesheets: string[];
  stylesheets: SourceStylesheet[];
  declarations: ObservedDeclaration[];
  theme: Partial<Record<"canvas" | "ink" | "fontBody", ObservedDeclaration>>;
  error: string | null;
};

export type OfficialCatalog = {
  schemaVersion: 1;
  generatedAt: string;
  registryHash: string;
  collectedIds: string[];
  sources: OfficialSource[];
  excluded: { id: string; reason: string }[];
};
