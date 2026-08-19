// La route courante, et comment en changer.
//
// `useSyncExternalStore` plutôt qu'un `useState` + `useEffect` : le hash est un
// état EXTÉRIEUR à React (le bouton retour du navigateur le change sans nous
// prévenir). Le raccorder comme un store externe, c'est ce qui garantit qu'un
// rendu ne lit jamais une route périmée — et c'est aussi ce qui fait marcher le
// geste de retour d'iOS sans une ligne de plus.

import { useCallback, useSyncExternalStore } from "react";
import { chemin, lireRoute, ROUTE_DEFAUT, type Route } from "./routes";

const abonner = (cb: () => void): (() => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

const lireHash = (): string => window.location.hash;
// Le rendu serveur n'existe pas ici, mais Vitest, si : sans instantané de
// repli, `useSyncExternalStore` lève dès qu'il n'y a pas de `window`.
const hashServeur = (): string => "";

export function useRoute(): Route {
  const hash = useSyncExternalStore(abonner, lireHash, hashServeur);
  return hash ? lireRoute(hash) : ROUTE_DEFAUT;
}

/** Navigue. `remplacer` écrase l'entrée courante au lieu d'en empiler une —
 *  pour les redirections, qui n'ont rien à faire dans l'historique du pouce. */
export function aller(r: Route, remplacer = false): void {
  const c = chemin(r);
  if (remplacer) window.history.replaceState(null, "", c);
  else window.location.hash = c.slice(1);
}

/** Un gestionnaire de clic prêt à poser sur un bouton. */
export function useAller(): (r: Route, remplacer?: boolean) => void {
  return useCallback((r: Route, remplacer = false) => aller(r, remplacer), []);
}
