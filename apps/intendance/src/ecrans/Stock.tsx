// Écran « L’inventaire » — T15 du backlog.
//
// Les catégories et leur fiabilité, les deux plafonds par
// espace, les lots.
//
// PLACE TENUE, PAS ÉCRAN VIDE. La coquille de T7 route déjà vers ici : un
// écran qui n'existe pas encore doit le DIRE, sinon la navigation se teste
// contre du blanc et on ne sait pas si c'est la route ou l'écran qui manque.

import { Corps } from "../ui/Coquille";
import { AVenir } from "../ui/AVenir";

export function Stock() {
  return (
    <Corps plat>
      <AVenir titre="L’inventaire" ticket="T15" quoi="Les catégories et leur fiabilité, les deux plafonds par espace, les lots." />
    </Corps>
  );
}
