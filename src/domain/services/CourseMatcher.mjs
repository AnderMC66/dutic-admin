const STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "y", "en", "para", "curso", "2026a", "2026b"]);

// Marcas combinantes (las tildes que deja NFD al descomponer "ó" en "o" + acento).
// Se usa la propiedad Unicode \p{M} en vez de un rango U+0300-U+036F escrito a
// mano: ese rango obliga a poner las marcas literales en el código, que son
// invisibles en el editor y se pierden en cualquier normalización del archivo.
const COMBINING_MARKS = /\p{M}/gu;

/**
 * Qué proporción de palabras clave hay que compartir para dar dos nombres por el
 * mismo curso. Con 0.5 justo "ECONOMÍA POLÍTICA" y "ECONOMÍA GENERAL" empatarían
 * (comparten 1 de 2), así que hace falta pasarse de ahí.
 */
const MIN_SIMILARITY = 0.6;

/** Palabras clave normalizadas (sin tildes, sin stopwords) de un nombre de curso/texto. */
export function keywords(text) {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

/**
 * Qué tanto se parecen dos nombres de curso, de 0 a 1: proporción de palabras
 * clave compartidas sobre el nombre MÁS CORTO de los dos. Se divide por el más
 * corto a propósito, porque las fuentes abrevian distinto — SISACAD dice
 * "DESARROLLO EMOCIONAL" donde Moodle dice "DESARROLLO EMOCIONAL, GESTIÓN DE
 * CONFLICTOS Y LIDERAZGO GA", y eso es el mismo curso, no un 40% de curso.
 */
export function courseSimilarity(nameA, nameB) {
  const a = new Set(keywords(nameA));
  const b = new Set(keywords(nameB));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/** true si dos nombres de curso son, con alta probabilidad, el mismo curso. */
export function sameCourse(nameA, nameB) {
  return courseSimilarity(nameA, nameB) >= MIN_SIMILARITY;
}

/**
 * De varios candidatos, el que mejor coincide con `targetName` — o null.
 *
 * Reemplaza al `find(c => sameCourse(...))` que había, que se quedaba con el
 * PRIMERO que compartiera una sola palabra clave: "MATEMÁTICAS PARA ECONOMISTAS
 * III" y "ESTADÍSTICA PARA ECONOMISTAS III" comparten "economistas", así que la
 * nota de un curso se le podía atribuir al otro sin que nada lo delatara. Acá se
 * puntúan todos y, si hay empate en el primer puesto, se devuelve null: mejor no
 * saber que decirte que estás en riesgo en el curso equivocado.
 *
 * @template T @param {string} targetName @param {T[]} candidates
 * @param {(candidate:T) => string} nameOf @returns {T|null}
 */
export function findBestCourseMatch(targetName, candidates, nameOf) {
  const ranked = (candidates ?? [])
    .map((candidate) => ({ candidate, score: courseSimilarity(targetName, nameOf(candidate)) }))
    .filter((entry) => entry.score >= MIN_SIMILARITY)
    .sort((x, y) => y.score - x.score);

  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
  return ranked[0].candidate;
}
