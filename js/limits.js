// Limites por conta (verificados no site). As contas privilegiadas (e o admin)
// têm limites maiores; o resto usa os limites base.
export const BASE_LIMITS = {
  characters: 5,
  costumes: 15,
  pets: 5,
};

export const PRIVILEGED_LIMITS = {
  characters: 10,
  costumes: 50,
  pets: 10,
};

export function limitsFor(privileged) {
  return privileged ? PRIVILEGED_LIMITS : BASE_LIMITS;
}
