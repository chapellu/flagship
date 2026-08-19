// Écran « Aujourd’hui » — T8 du backlog.
//
// Ce soir, le geste du jour, l'offre en attente, demain.
// Sans défilement sur un 390 × 844 : c'est la thèse de l'écran.
//
// PLACE TENUE, PAS ÉCRAN VIDE. La coquille de T7 route déjà vers ici : un
// écran qui n'existe pas encore doit le DIRE, sinon la navigation se teste
// contre du blanc et on ne sait pas si c'est la route ou l'écran qui manque.

import { Corps } from "../ui/Coquille";
import { AVenir } from "../ui/AVenir";

export function Aujourdhui() {
  return (
    <Corps plat>
      <AVenir titre="Aujourd’hui" ticket="T8" quoi="Ce soir, le geste du jour, l'offre en attente, demain. Sans défilement sur un 390 × 844 : c'est la thèse de l'écran." />
    </Corps>
  );
}
