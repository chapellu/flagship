// Écran « Les parts » — T14 du backlog.
//
// Deux cibles de 64 px, pas de 0,5, l'aperçu de la semaine.
//
// PLACE TENUE, PAS ÉCRAN VIDE. La coquille de T7 route déjà vers ici : un
// écran qui n'existe pas encore doit le DIRE, sinon la navigation se teste
// contre du blanc et on ne sait pas si c'est la route ou l'écran qui manque.

import { Corps } from "../ui/Coquille";
import { AVenir } from "../ui/AVenir";

export function Parts() {
  return (
    <Corps plat>
      <AVenir titre="Les parts" ticket="T14" quoi="Deux cibles de 64 px, pas de 0,5, l'aperçu de la semaine." />
    </Corps>
  );
}
