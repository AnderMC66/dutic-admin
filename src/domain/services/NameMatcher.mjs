function tokens(name) {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z]+/)
    .filter((t) => t.length > 2);
}

/**
 * true si dos nombres probablemente son la misma persona. Los nombres
 * oficiales de DUTIC vienen completos ("RODRIGO ANDERSON CAPIA CONDORI") y
 * los de WhatsApp suelen ser un apodo o nombre parcial ("Rodrigo Capia") —
 * por eso se compara por superposición de tokens, no por igualdad exacta.
 */
export function namesMatch(nameA, nameB) {
  const ta = tokens(nameA);
  const tb = tokens(nameB);
  if (!ta.length || !tb.length) return false;
  const overlap = ta.filter((t) => tb.includes(t)).length;
  return overlap >= 2 || (overlap >= 1 && Math.min(ta.length, tb.length) <= 2);
}

/**
 * Empareja un roster oficial contra los miembros de un grupo de WhatsApp.
 * Puro: solo compara los nombres ya obtenidos.
 */
export function matchRosterToGroup(roster, groupMembers) {
  const matched = [];
  const remaining = [...groupMembers];

  for (const person of roster) {
    const idx = remaining.findIndex((m) => namesMatch(person.name, m.name));
    if (idx >= 0) {
      matched.push({ roster: person, group: remaining[idx] });
      remaining.splice(idx, 1);
    }
  }

  const matchedRosterKeys = new Set(matched.map((m) => m.roster.name));
  const onlyInRoster = roster.filter((p) => !matchedRosterKeys.has(p.name));

  return { matched, onlyInRoster, onlyInGroup: remaining };
}
