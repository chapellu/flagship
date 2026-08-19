// La porte de la base. Les écrans importent d'ici, jamais des fichiers
// individuels : le jour où une table se découpe en deux, c'est ce fichier qui
// absorbe le changement.
export { base, Base, VERSION, schemaDeclare, jourISO, cleCreneau, cleArticle } from "./schema";
export type { DecisionCreneau, EtatCourse, LotStock, Reglage } from "./schema";
export { cleDuCreneau, indexDuCreneau, lireSemaine, hydrater, poser, reglerParts, oublier, decisionsAvant } from "./semaine";
export { cleDeLArticle, lireCourses, cocher, rentrer, rentrerLesCoches, viderCourses } from "./courses";
export { lireStock, amorcer, ajouterLot, corrigerLot, retirerLot, reamorcer } from "./stock";
