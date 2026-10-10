/**
 * Dans l'application, un champ de tableau (prix, quantité, description...) enregistre sa valeur quand on le quitte.
 * Appuyer sur Entrée fait la même chose : le champ est quitté, donc la valeur s'applique sans avoir à cliquer ailleurs.
 * Les champs d'un formulaire (Entrée envoie le formulaire), les cases à cocher, les boutons et les zones de texte
 * multilignes (Entrée = retour à la ligne) ne sont pas concernés.
 */
const SKIPPED_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color', 'range', 'image']);

export function enableEnterToCommit(): void {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented) return;
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || target.form || SKIPPED_TYPES.has(target.type)) return;
    target.blur();
  });
}
