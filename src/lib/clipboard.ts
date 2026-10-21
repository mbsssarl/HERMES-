/**
 * Copie un texte dans le presse-papiers. Renvoie true si la copie a réussi.
 *
 * L'API moderne (navigator.clipboard) n'existe que sur une page sécurisée (HTTPS ou localhost) : sur une adresse
 * réseau en http, elle est absente. On retombe alors sur l'ancienne méthode (sélection + commande « copy »).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // refus d'autorisation : on essaie la méthode de repli
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '0';
  field.style.left = '0';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  field.remove();
  return copied;
}
