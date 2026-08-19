// Écran « Courses » — T13 du backlog.
//
// Deux modes (magasin / maison), le hors-liste.
//
// PLACE TENUE, PAS ÉCRAN VIDE. La coquille de T7 route déjà vers ici : un
// écran qui n'existe pas encore doit le DIRE, sinon la navigation se teste
// contre du blanc et on ne sait pas si c'est la route ou l'écran qui manque.

import { Corps } from "../ui/Coquille";
import { AVenir } from "../ui/AVenir";

export function Courses() {
  return (
    <Corps plat>
      <AVenir titre="Courses" ticket="T13" quoi="Deux modes (magasin / maison), le hors-liste." />
    </Corps>
  );
}
