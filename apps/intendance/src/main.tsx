import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const racine = document.getElementById("racine");
// Le point de montage vient d'index.html ; s'il manque, c'est le HTML qui a
// dérivé, et un écran blanc silencieux serait la pire façon de l'apprendre.
if (!racine) throw new Error("#racine est absent d'index.html");

createRoot(racine).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
