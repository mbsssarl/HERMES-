/**
 * Rend lisible un message d'erreur venu du serveur. Convex enveloppe les erreurs de nos fonctions :
 *   « [CONVEX M(users:toggleUserStatus)] [Request ID: ...] Server Error Uncaught Error: <message> at handler (...) Called by client »
 * Seul <message> intéresse l'utilisateur. Une erreur technique sans message lisible (panne, bug) devient un texte neutre.
 */
export function humanizeError(text: string): string {
  const uncaught = /Uncaught (?:[A-Za-z]*Error):\s*([\s\S]*?)(?:\s+at\s+\S+\s+\(|\s+Called by client|$)/.exec(text);
  if (uncaught && uncaught[1].trim()) return uncaught[1].trim();
  if (/\[CONVEX|Request ID|Server Error/i.test(text)) return "Une erreur est survenue. Réessayez dans un instant.";
  return text;
}
