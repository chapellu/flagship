// Écran « Poser un plat » — T11 du backlog.
//
// Les trois chiffres épinglés, les cartes consomme/produit.
// L'écran central de la direction.
//
// PLACE TENUE, PAS ÉCRAN VIDE. La coquille de T7 route déjà vers ici : un
// écran qui n'existe pas encore doit le DIRE, sinon la navigation se teste
// contre du blanc et on ne sait pas si c'est la route ou l'écran qui manque.

import { Corps } from "../ui/Coquille";
import { AVenir } from "../ui/AVenir";

export function Poser() {
  return (
    <Corps plat>
      <AVenir titre="Poser un plat" ticket="T11" quoi="Les trois chiffres épinglés, les cartes consomme/produit. L'écran central de la direction." />
    </Corps>
  );
}
