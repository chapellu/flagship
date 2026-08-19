// Écran « En cuisine » — T12 du backlog.
//
// Mode guidé, une étape par écran, chauffe et minuteur,
// la liste d'ingrédients à un bouton.
//
// PLACE TENUE, PAS ÉCRAN VIDE. La coquille de T7 route déjà vers ici : un
// écran qui n'existe pas encore doit le DIRE, sinon la navigation se teste
// contre du blanc et on ne sait pas si c'est la route ou l'écran qui manque.

import { Corps } from "../ui/Coquille";
import { AVenir } from "../ui/AVenir";

export function Cuisiner() {
  return (
    <Corps plat>
      <AVenir titre="En cuisine" ticket="T12" quoi="Mode guidé, une étape par écran, chauffe et minuteur, la liste d'ingrédients à un bouton." />
    </Corps>
  );
}
