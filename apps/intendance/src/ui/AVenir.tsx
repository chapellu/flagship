// Le carton d'un écran qui n'est pas encore écrit.
//
// Il dit lequel, et à quel ticket il appartient. C'est ce qui permet de tester
// la navigation AVANT les écrans : en tapant une URL sur le téléphone, on voit
// tout de suite si c'est la route qui rate ou l'écran qui manque.

export function AVenir({ titre, ticket, quoi }: { titre: string; ticket: string; quoi: string }) {
  return (
    <>
      <div className="co-kicker accent">{ticket}</div>
      <div className="co-h" style={{ margin: "var(--space-1) 0 var(--space-3)" }}>
        {titre}
      </div>
      <div className="co-vide">{quoi}</div>
    </>
  );
}
