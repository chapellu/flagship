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
