// Les icônes — Lucide, à trait 2,75.
//
// Inline plutôt qu'un paquet : la direction n'en utilise qu'une douzaine, et un
// `lucide-react` complet pèse plus que tout le reste de l'app réunie. Le trait
// épais n'est pas un caprice — c'est le système Organic qui le demande, pour
// que les icônes aient le même poids visuel que le Caprasimo.

import type { SVGProps } from "react";

const Ico = ({ t = 16, d, ...reste }: { t?: number; d: string } & SVGProps<SVGSVGElement>) => (
  <svg
    width={t}
    height={t}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flex: "none" }}
    aria-hidden
    {...reste}
    dangerouslySetInnerHTML={{ __html: d }}
  />
);

const D = {
  parts:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  gamelle:
    '<rect x="2" y="7" width="20" height="14" rx="3"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M2 13h20"/>',
  frigo:
    '<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M5 10h14"/><path d="M9 6v1"/><path d="M9 14v2"/>',
  congelo: '<path d="M12 3v18"/><path d="M4.5 7.5 19.5 16.5"/><path d="M19.5 7.5 4.5 16.5"/>',
  placard:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 3v18"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
  alerte: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  bebe: '<path d="M8 3h8l-1 4H9Z"/><path d="M7 7h10l-1 13a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1Z"/>',
  minuteur:
    '<path d="M6 4h12"/><path d="M9 4v3a3 3 0 0 0 6 0V4"/><circle cx="12" cy="14" r="7"/><path d="M12 11v3l2 1"/>',
  cloche: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 21h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h1v4h1"/>',
  enfant: '<circle cx="12" cy="7" r="4"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>',
  four:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18"/><path d="M8 6h.01"/><path d="M12 6h.01"/><circle cx="12" cy="15" r="2.5"/>',
} as const;

export type NomIcone = keyof typeof D;

export const Icone = ({ nom, t }: { nom: NomIcone; t?: number }) => (
  <Ico d={D[nom]} {...(t === undefined ? {} : { t })} />
);

/** L'icône d'un espace de rangement — le stock et les cartes en ont besoin. */
export const iconeEspace = (espace: string): NomIcone =>
  espace === "congelo" ? "congelo" : espace === "placard" ? "placard" : "frigo";
