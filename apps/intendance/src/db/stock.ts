// Le stock réel du foyer.
//
// Le catalogue porte un stock, mais c'est une AMORCE : un instantané exporté du
// modèle Python, juste au moment de l'export. Dès qu'un doigt rentre des
// courses ou corrige un lot, c'est la base qui fait foi — et il faut que ce
// basculement soit explicite, sinon un ré-export du catalogue écraserait
// silencieusement ce que le foyer a constaté de ses propres yeux.
//
// D'où `amorcer()` : il ne s'exécute qu'une fois, et il le sait.

import { jourISO, type Base, type LotStock } from "./schema";
import type { LotInitial } from "../model/depot";
import type { Jeu } from "../model/jeu";
import type { Catalogue } from "../model/types";

const CLE_AMORCE = "stock.amorce";

export const lireStock = (base: Base): Promise<LotStock[]> => base.stock.toArray();

/**
 * Recopie le stock du catalogue dans la base, une seule fois dans la vie de
 * cette base. Le drapeau est posé dans la même transaction que l'écriture :
 * une amorce interrompue à mi-chemin ne doit pas se croire terminée, ni
 * repartir de zéro par-dessus des lots déjà écrits.
 */
export async function amorcer(base: Base, catalogue: Catalogue): Promise<boolean> {
  return base.transaction("rw", base.stock, base.reglages, async () => {
    if (await base.reglages.get(CLE_AMORCE)) return false;
    const maj = Date.now();
    await base.stock.bulkAdd(
      catalogue.stock.map((o) => ({
        type: o.type,
        kind: o.kind,
        qty: o.qty.amount,
        unite: o.qty.unit,
        band: o.qty_band,
        espace: o.location,
        born: o.born,
        origine: null,
        maj,
      })),
    );
    await base.reglages.put({ cle: CLE_AMORCE, valeur: maj, maj });
    return true;
  });
}

/** Ajoute un lot constaté — une course rentrée, un bocal trouvé au fond du
 *  placard. `born` par défaut à aujourd'hui : la fraîcheur se compte depuis le
 *  jour où la chose est arrivée, pas depuis un jour qu'on aurait oublié. */
export async function ajouterLot(
  base: Base,
  lot: Omit<LotStock, "id" | "maj" | "born"> & { born?: string },
): Promise<number> {
  // `add` rend la clé auto-incrémentée ; son type Dexie l'admet optionnelle
  // parce que la table pourrait avoir une clé fournie. Ici elle ne l'est pas.
  const id = await base.stock.add({
    ...lot,
    born: lot.born ?? jourISO(new Date()),
    maj: Date.now(),
  });
  return id as number;
}

export async function corrigerLot(base: Base, id: number, patch: Partial<LotStock>): Promise<void> {
  await base.stock.update(id, { ...patch, maj: Date.now() });
}

/** Retire un lot : on l'a fini, ou il n'a jamais existé que dans la base. */
export const retirerLot = (base: Base, id: number): Promise<void> => base.stock.delete(id);

/** Remet le stock à l'amorce du catalogue. Réservé aux réglages — c'est le
 *  geste « je repars de l'export », et il jette ce que le foyer a constaté. */
export async function reamorcer(base: Base, catalogue: Catalogue): Promise<void> {
  await base.transaction("rw", base.stock, base.reglages, async () => {
    await base.stock.clear();
    await base.reglages.delete(CLE_AMORCE);
  });
  await amorcer(base, catalogue);
}

/* ────────────────────────────────────────────── de la base vers le modèle */

/**
 * Un lot de la base, vu par le dépôt.
 *
 * UNE QUANTITÉ SANS UNITÉ NE CHIFFRE RIEN. `LotStock` porte les deux
 * séparément, parce qu'un lot peut se constater sans se peser ; le dépôt, lui,
 * compare des grandeurs, et « 3 » face à « 400 g » n'est pas une comparaison.
 * Il n'y a donc de quantité que quand les deux sont là — sinon le lot part en
 * entier et `prelever` le dit (`approximatif`) au lieu de faire semblant.
 *
 * `ref` est la clé de base, pour que l'écran retrouve la ligne qu'un doigt
 * touche sans faire correspondre deux listes par leur index.
 */
export const auModele = (l: LotStock): LotInitial => ({
  type: l.type,
  kind: l.kind,
  qty: l.qty != null && l.unite ? { amount: l.qty, unit: l.unite } : null,
  qty_band: l.band,
  born: l.born,
  location: l.espace,
  ...(l.id == null ? {} : { ref: String(l.id) }),
});

/**
 * Repose le stock de la base sur le jeu. MUTE `jeu` et le rend, comme
 * `hydrater` le fait des créneaux — et pour la même raison : le modèle mute son
 * état, et un second style ici ne rendrait pas le premier meilleur.
 *
 * L'ORDRE EST CELUI DE LA BASE, c'est-à-dire celui des `++id` : les lots se
 * servent dans l'ordre où ils ont été constatés. C'est déjà l'ordre du
 * catalogue, donc rien ne change de ce côté. Servir le plus vieux d'abord
 * serait sans doute plus juste dans une cuisine — mais ce serait une décision
 * sur le modèle, pas une traduction, et elle appartient au modèle Python.
 */
export function hydraterStock(jeu: Jeu, lots: LotStock[]): Jeu {
  jeu.stock = lots.map(auModele);
  return jeu;
}
