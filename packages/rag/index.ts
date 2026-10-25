import { Python } from "bun:python";
import { hybridSearch } from "../native-ai/index.ts";
import {
  normalize,
  plainText,
  searchTerms,
  type Archive,
} from "../archive/index.ts";

export function questionLanguage(question: string): string | undefined {
  const text = normalize(question);
  if (
    /[誰何]|なぜ|どう|とは|ですか/.test(question) ||
    (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(question) &&
      /[?？]/.test(question))
  )
    return "ja";
  const french =
    /\b(?:qui|quel|quelle|quels|quelles|pourquoi|comment|quand|ou|combien)\b/.test(
      text,
    );
  const english =
    /\b(?:who|what|which|why|how|where|when|whose)\b/.test(text) ||
    /^(?:is|are|does|do|can)\b/.test(text);
  return french === english ? undefined : french ? "fr" : "en";
}

export async function ask(archive: Archive, question: string, lang?: string) {
  if (!question.trim() || question.length > 2000)
    throw new Error("Question requise, maximum 2000 caractères");
  if (lang !== undefined && !["fr", "en", "ja", "und"].includes(lang))
    throw new Error("Langue non prise en charge : fr, en, ja ou und");
  const language = lang ?? questionLanguage(question);
  let retrieval = await hybridSearch(archive, question, {
    limit: 12,
    lang: language,
  });
  let passages = retrieval.hits;
  // Unknown-language local imports remain usable when automatic inference finds no corpus.
  if (!passages.length && lang === undefined && language) {
    retrieval = await hybridSearch(archive, question, {
      limit: 12,
      lang: "und",
    });
    passages = retrieval.hits;
  }
  const identity = /\bqui est\b|\bwho is\b|\bwhat is\b|とは|誰/i.test(question);
  if (identity) {
    const subject = searchTerms(question);
    // Entity resolution uses document leads, never whichever chunk happened to win RRF.
    const documents = [
      ...new Map(passages.map((p) => [p.url, p])).values(),
    ].map((p) => {
      const source = archive.db
        .query<{ text: string; id: number }, [string]>(
          "SELECT d.text,c.id FROM documents d JOIN chunks c ON c.document_id=d.id AND c.ordinal=0 WHERE d.url=?",
        )
        .get(p.url);
      const raw = source?.text ?? p.text;
      const heading = raw.search(/^#{1,6}\s+/m);
      const lead = plainText(heading > 0 ? raw.slice(0, heading) : raw).slice(
        0,
        12000,
      );
      return { ...p, id: source?.id ?? p.id, text: lead };
    });
    const disambiguation = /page d.homonymie|disambiguation|may refer to/i;
    const primary =
      /personnage principal|main character|principal(?:aux|e|es)? protagoniste|main protagonist|主人公/i;
    const variant =
      /alter[ -]ego|counterpart|alternate (?:version|universe)|version (?:d[’']|alternative)|別世界|別人/i;
    const indexPages = documents.filter((p) =>
      disambiguation.test(p.text.slice(0, 400)),
    );
    const entities = documents.filter(
      (p) =>
        !/\bfaq\b|frequently asked|questions frequentes/i.test(
          normalize(p.title),
        ) && !disambiguation.test(p.text.slice(0, 400)),
    );
    const rank = (passage: (typeof documents)[number]) => {
      const name = searchTerms(passage.title),
        words = name.split(" "),
        terms = subject.split(" ");
      const overlap = terms.filter((term) => words.includes(term)).length;
      const lexical =
        overlap / Math.max(1, words.length) +
        (name.startsWith(subject) ? 0.5 : 0);
      if (!overlap) return 0;
      // A fully specified title wins; generic given names can use explicit main/variant evidence.
      if (name === subject) return lexical + 3;
      const labelledMain = indexPages.some((p) =>
        p.text
          .split("\n")
          .some(
            (line) =>
              normalize(line).includes(normalize(passage.title)) &&
              primary.test(line),
          ),
      );
      return (
        lexical +
        (labelledMain ? 1.5 : 0) +
        (primary.test(passage.text) ? 0.6 : 0) -
        (variant.test(passage.text) ? 0.6 : 0)
      );
    };
    entities.sort((a, b) => rank(b) - rank(a));
    const entity = entities[0];
    if (entity && rank(entity) >= 0.5) passages = [entity];
  }
  const payload = {
    question,
    identity,
    retrievalQuery: searchTerms(question),
    passages,
  };
  await using py = await Python.async();
  await py.run(await Bun.file(new URL("./rag.py", import.meta.url)).text());
  // JSON string literals are also safe Python string expressions; data is never interpolated as code.
  const encoded = JSON.stringify(JSON.stringify(payload));
  const answer = await py.evalJSON<{
    answer: string;
    sources: { id: number; title: string; url: string }[];
  }>(`answer(json.loads(${encoded}))`);
  return {
    ...answer,
    retrieval: {
      engine: retrieval.ranking,
      mode: retrieval.mode,
      neuralEmbeddings: false,
      ...(retrieval.vectorError ? { vectorError: retrieval.vectorError } : {}),
    },
  };
}
