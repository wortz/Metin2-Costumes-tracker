// A app gere dois "sistemas" iguais: trajes e pets. Cada um tem as suas próprias
// coleções no Firestore para itens e secções. As personagens são partilhadas:
// uma personagem guardada uma vez existe nos trajes e nos pets.
export const KINDS = {
  costume: { items: "costumes", sections: "sections", characters: "characters" },
  pet: { items: "pets", sections: "petSections", characters: "characters" },
};

export function collectionsFor(kind = "costume") {
  return KINDS[kind] || KINDS.costume;
}
