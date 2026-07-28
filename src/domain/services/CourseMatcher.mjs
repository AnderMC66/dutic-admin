const STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "y", "en", "para", "curso", "2026a", "2026b"]);

/** Palabras clave normalizadas (sin tildes, sin stopwords) de un nombre de curso/texto. */
export function keywords(text) {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

/** true si dos nombres de curso comparten al menos una palabra clave significativa. */
export function sameCourse(nameA, nameB) {
  const wordsA = keywords(nameA);
  const wordsB = keywords(nameB);
  return wordsA.some((w) => wordsB.includes(w));
}
