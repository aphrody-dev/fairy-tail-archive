"""Dependency-free extractive RAG. No model, API key or network call."""
import json
import math
import re
import unicodedata
from collections import Counter


def tokens(text):
    text = unicodedata.normalize("NFD", unicodedata.normalize("NFKC", text).lower())
    text = re.sub(r"([a-z])[\u0300-\u036f]+", r"\1", text)
    text = unicodedata.normalize("NFC", text)
    latin = re.findall(r"[a-z0-9]+", text)
    cjk = re.findall(r"[\u3040-\u30ff\u3400-\u9fff]+", text)
    return latin + [s[i:i+2] for s in cjk for i in range(max(1, len(s)-1))]


def answer(payload):
    question = Counter(tokens(payload["retrievalQuery"]))
    identity = payload["identity"]
    passages = payload["passages"]
    if not passages:
        return {"answer": "Aucune source pertinente dans l'archive.", "sources": []}
    rows = []
    for passage in passages:
        if identity and re.search(r"page d.homonymie|disambiguation|may refer to", passage["text"][:400], re.I):
            continue
        prose = re.sub(r"\(\?\)\s*Terme issu de la traduction officielle[^!\n]*!\s*", "", passage["text"])
        for sentence in re.split(r"(?<=[.!?])\s+|(?<=[。！？])|\n+", prose):
            if identity and (sentence.rstrip().endswith(("?", "？")) or re.search(r"^\s*(?:qui est|who is|what is)\b", sentence, re.I)):
                continue
            terms = Counter(tokens(sentence))
            overlap = sum(min(n, terms[t]) for t, n in question.items())
            length = sum(terms.values())
            if overlap == 0 or length < 4 or sentence.lstrip().startswith(("|", "- ")):
                continue
            coverage = overlap / max(1, sum(question.values()))
            score = 2 * coverage + overlap / math.sqrt(max(1, length))
            score += min(3, passage["score"]) * 0.15
            if identity:
                title_terms=tokens(passage["title"])
                score+=0.8*len(set(question)&set(title_terms))/max(1,len(set(title_terms)))
                if re.search(r"\bmage\b|\bprotagonist[es]*\b|\bcharacter\b|\bdragon[s]?\b|魔導士|主人公", sentence, re.I):
                    score += 1.0
            if identity and re.search(r"\best (?:un|une|le|la)\b|\bis (?:a|an|the)\b|は.*(?:です|である|魔導士)", sentence):
                score += 0.8
            if score > 0:
                rows.append((score, sentence.strip(), passage))
    rows.sort(key=lambda row: row[0], reverse=True)
    sources, sentences, seen = [], [], set()
    for score, sentence, passage in rows:
        if sentence in seen:
            continue
        seen.add(sentence)
        source = {"id": passage["id"], "title": passage["title"], "url": passage["url"]}
        if source not in sources:
            sources.append(source)
        sentences.append(f"{sentence} [{sources.index(source) + 1}]")
        if len(sentences) == (1 if identity else 3):
            break
    return {"answer": " ".join(sentences) or "Les sources ne permettent pas de répondre.", "sources": sources}
