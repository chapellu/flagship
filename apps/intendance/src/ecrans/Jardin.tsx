// Écran « Jardin ».
//
// La facette jardin n'est pas ce que cette direction teste — aucun ticket ne la
// couvre. Elle existe pour que la barre du bas ne soit pas un mensonge : une
// coquille à trois facettes dont deux n'ouvrent rien ne se juge pas.

import { Corps } from "../ui/Coquille";
import { AVenir } from "../ui/AVenir";

export function Jardin() {
  return (
    <Corps plat>
      <AVenir
        titre="Jardin"
        ticket="hors backlog"
        quoi="La facette existe pour que la coquille en porte réellement deux. Son contenu viendra quand le jardin sera le sujet."
      />
    </Corps>
  );
}
