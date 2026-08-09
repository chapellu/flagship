// PROTOTYPE — données en dur, en mémoire. Sources : Workspace#2 (le site de
// Francheville) et la sortie du recipe-compiler (ticket #31).

export const foyer = {
  lieu: "Francheville (Rhône) — zone 8b",
  mangeurs: "2 adultes · 1 grand (tâches 👶 dès 36 mois) · 1 bébé (portion non salée)",
  equipement: ["petit blender", "sauteuse 28 cm", "cocotte + panier vapeur", "mixeur plongeur"],
  facettes: [
    { id: "jardin", nom: "Jardin", emoji: "🌱", version: "proto" },
    { id: "cuisine", nom: "Cuisine", emoji: "🍲", version: "proto" },
  ],
};

export const cellules = [
  { id: "bac1", nom: "Bac 1", contenu: "Lilas, succulente, lavande", type: "bac",
    statut: "plein", note: "Ornemental, permanent", sol: 0.7, x: 4, y: 8, w: 40, h: 18 },
  { id: "bac2", nom: "Bac 2", contenu: "3 tomates, 2 basilics", type: "bac",
    statut: "alerte", note: "100 × 40 cm, prof. 70 cm — densité ~180 % de la reco",
    sol: 0.45, derniereObs: "il y a 5 semaines", x: 4, y: 30, w: 40, h: 18 },
  { id: "bac3", nom: "Bac 3", contenu: "Lavande, thym, fraisier, framboisier", type: "bac",
    statut: "ok", note: "Vivaces, presque plein", sol: 0.6, x: 4, y: 52, w: 40, h: 18 },
  { id: "bac4", nom: "Bac 4", contenu: "3 lauriers-cerises", type: "bac",
    statut: "fixe", note: "Écran voisin, fixe", sol: 0.8, x: 4, y: 74, w: 40, h: 18 },
  { id: "citron", nom: "Pot citron", contenu: "Citronnier", type: "pot",
    statut: "alerte", note: "40 cm — à hiverner avant les gelées (pot de 50-80 kg !)",
    sol: 0.2, x: 58, y: 30, w: 22, h: 22 },
  { id: "pots", nom: "Pots libres", contenu: "Vides", type: "pot",
    statut: "libre", note: "Mobiles — l'échappatoire à la rotation", sol: 0.1,
    x: 58, y: 62, w: 22, h: 22 },
];

export const quetes = [
  { id: "q1", titre: "Semer la mâche", detail: "Fenêtre : avant mi-septembre — « get it sown by September »", fenetre: "ouverte", cellule: "bac2" },
  { id: "q2", titre: "Semer les épinards d'hiver", detail: "Récolte sur stock tout l'hiver", fenetre: "ouverte", cellule: "pots" },
  { id: "q3", titre: "Observer le bac 2", detail: "Dernière observation : il y a 5 semaines", fenetre: "nudge", cellule: "bac2" },
  { id: "q4", titre: "Récolter le basilic", detail: "Émet un flag « vu, disponible » vers la cuisine", fenetre: "ouverte", cellule: "bac2" },
  { id: "q5", titre: "Prévoir l'hivernage du citronnier", detail: "Premières gelées fin octobre — logistique 50-80 kg", fenetre: "bientot", cellule: "citron" },
];

export const stock = [
  { id: "s1", nom: "Lentilles vertes cuites", detail: "2 repas · frigo · J-2", origine: "cuisine" },
  { id: "s2", nom: "Basilic frais", detail: "Récolte du jour · terrasse", origine: "jardin", flag: true },
];

// Sortie compilée réelle : `compile.py burgers-de-lentilles` (foyer Francheville).
export const dinerCeSoir = {
  nom: "Petits burgers de lentilles au tofu fumé",
  source: "d'après Marie Chioca — recette reformulée",
  duree: 39,
  reste: "Démarre sur le reste « lentilles vertes cuites » (frigo, J-2)",
  emet: "burgers-lentilles → frigo 3 j ou congélo (très bons froids)",
  etapes: [
    { txt: "Faire dorer oignons émincés + tofu fumé en dés — sauteuse 28 cm", min: 10 },
    { txt: "Hacher grossièrement — au petit blender, en 2-3 fois, par impulsions courtes", min: 5 },
    { txt: "Portion bébé : prélever 3 c. à s. de lentilles nature avant d'assaisonner", min: 3, bebe: true },
    { txt: "Mélanger lentilles, cube émietté, poivre, farine ; pétrir", min: 4, kid: "malaxer la pâte avec les mains (propres !)" },
    { txt: "Façonner une dizaine de petites croquettes", min: 5, kid: "tapoter et former les croquettes" },
    { txt: "Rouler dans le son d'avoine", min: 4, kid: "rouler les croquettes dans l'assiette" },
    { txt: "Dorer quelques minutes de chaque côté — sauteuse 28 cm", min: 8 },
  ],
};

// Flux mêlé pour la variante C (du plus récent au plus ancien).
export const journal = [
  { facette: "cuisine", quand: "ce soir", titre: "Dîner compilé : burgers de lentilles (39 min)",
    detail: "Utilise le reste de lentilles (J-2) — et le basilic récolté ?" },
  { facette: "jardin", quand: "17 h 40", titre: "Récolte : basilic (bac 2)",
    detail: "→ flag « vu, disponible » émis vers la cuisine", lien: true },
  { facette: "jardin", quand: "17 h 25", titre: "Observation : bac 2",
    detail: "Tomates : 4 fruits mûrs à venir. Densité toujours limite — arrosage quotidien." },
  { facette: "jardin", quand: "hier", titre: "Nudge : fenêtre de semis ouverte",
    detail: "Mâche + épinards d'hiver : semer avant mi-septembre." },
  { facette: "cuisine", quand: "avant-hier", titre: "Consigné au stock : lentilles vertes cuites",
    detail: "2 repas · sortie « emets » de lentilles-mijotées" },
  { facette: "jardin", quand: "il y a 5 sem.", titre: "Observation : bac 2",
    detail: "Dernière observation en date — d'où le nudge d'aujourd'hui." },
];

export function enTete() {
  const d = new Date();
  const fmt = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return { date: fmt.charAt(0).toUpperCase() + fmt.slice(1), saison: "Semaines des semis d'automne" };
}
