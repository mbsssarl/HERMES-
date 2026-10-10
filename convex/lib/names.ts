/**
 * Met une majuscule à la première lettre de chaque mot (« akira international » devient « Akira International »).
 * Le reste du mot est laissé tel que saisi : un sigle écrit en majuscules (« ABC », « LTD ») reste intact.
 */
export function capitalizeWords(text: string): string {
  return text.replace(/(^|[\s\-'’(\/.])(\p{Ll})/gu, (_m, sep: string, letter: string) => sep + letter.toLocaleUpperCase());
}
