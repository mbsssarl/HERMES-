import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * ÉTAT AUTOMATIQUE « EN COURS » <-> « EN ATTENTE DU FOURNISSEUR » (une seule fonction, appelée partout où une ligne change).
 *
 * Règle (commune à toutes les entreprises) :
 *  - il reste au moins une ligne SANS PRIX  -> la commande passe « En attente du fournisseur » (awaiting_supplier) ;
 *  - toutes les lignes ont un prix           -> elle revient « En cours » (processing).
 *
 * Une ligne « À confirmer » (plusieurs produits proches) ou inconnue n'a pas de prix : elle compte donc comme manquante.
 * Une ligne a un prix si le catalogue lui en donne un (unitPriceOriginal) ou si un prix a été saisi / lu dans le fichier
 * (unitPriceManual).
 *
 * Les lignes DÉCOCHÉES (excluded) sont ignorées : c'est notamment le cas des intitulés de section du fichier client
 * (« FRESH PROVISIONS »...), importés décochés et sans prix - ils ne doivent pas retenir la commande indéfiniment.
 *
 * Cette fonction ne touche JAMAIS aux autres états : brouillon, devis prêt (completed), envoyé (sent), PO reçu (po),
 * archivée (archived). Elle ne fait aucune écriture quand l'état ne change pas (moins de coût, pas de conflit).
 */
export async function refreshOrderStatus(ctx: MutationCtx, orderId: Id<"orders">): Promise<void> {
  const order = await ctx.db.get(orderId);
  if (!order || order.deletedAt !== undefined) return;
  if (order.status !== "processing" && order.status !== "awaiting_supplier") return;

  // On s'arrête à la première ligne sans prix : inutile de lire les autres.
  let missing = false;
  for await (const item of ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", orderId))) {
    if (item.excluded === true) continue;
    if (item.unitPriceOriginal === undefined && item.unitPriceManual === undefined) {
      missing = true;
      break;
    }
  }

  const next = missing ? "awaiting_supplier" : "processing";
  if (next !== order.status) await ctx.db.patch(orderId, { status: next, updatedAt: Date.now() });
}
