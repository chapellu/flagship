// Écran « Le cockpit » — T16 du backlog.
//
// La journée d'abord, les cartes de facette ensuite.
//
// PLACE TENUE, PAS ÉCRAN VIDE. La coquille de T7 route déjà vers ici : un
// écran qui n'existe pas encore doit le DIRE, sinon la navigation se teste
// contre du blanc et on ne sait pas si c'est la route ou l'écran qui manque.

import { Corps } from "../ui/Coquille";
import { AVenir } from "../ui/AVenir";

export function Cockpit() {
  return (
    <Corps plat>
      <AVenir titre="Le cockpit" ticket="T16" quoi="La journée d'abord, les cartes de facette ensuite." />
    </Corps>
  );
}
