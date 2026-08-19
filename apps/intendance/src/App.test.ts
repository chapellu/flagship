import { expect, test } from "vitest";
import { App } from "./App";

// Le filet minimal du squelette : le module se charge et exporte un composant.
// Il ne vaut pas grand-chose en soi — sa raison d'être est que `npm test` ait
// une réponse dès T1, pour que le premier vrai test n'ait pas à installer le
// harnais en même temps qu'il teste quelque chose.
test("l'app est un composant", () => {
  expect(typeof App).toBe("function");
});
