// Écran « La semaine » — T9 du backlog.
//
// Sept journées, midi/soir, le point sauge du chaînage,
// la plomberie au doigt.
//
// PLACE TENUE, PAS ÉCRAN VIDE. La coquille de T7 route déjà vers ici : un
// écran qui n'existe pas encore doit le DIRE, sinon la navigation se teste
// contre du blanc et on ne sait pas si c'est la route ou l'écran qui manque.

import { Corps } from "../ui/Coquille";
import { AVenir } from "../ui/AVenir";

export function Semaine() {
  return (
    <Corps plat>
      <AVenir titre="La semaine" ticket="T9" quoi="Sept journées, midi/soir, le point sauge du chaînage, la plomberie au doigt." />
    </Corps>
  );
}
