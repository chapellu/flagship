// Écran « À prévoir » — T10 du backlog.
//
// Déjà enchaîné / offres ouvertes, avec leurs réserves.
//
// PLACE TENUE, PAS ÉCRAN VIDE. La coquille de T7 route déjà vers ici : un
// écran qui n'existe pas encore doit le DIRE, sinon la navigation se teste
// contre du blanc et on ne sait pas si c'est la route ou l'écran qui manque.

import { Corps } from "../ui/Coquille";
import { AVenir } from "../ui/AVenir";

export function Prevoir() {
  return (
    <Corps plat>
      <AVenir titre="À prévoir" ticket="T10" quoi="Déjà enchaîné / offres ouvertes, avec leurs réserves." />
    </Corps>
  );
}
