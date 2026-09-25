import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

// Schéma complet de l'application. Voir convex/README.md pour une vue
// d'ensemble des tables, de leurs relations et du rôle de chaque fichier.
const schema = defineSchema({
  // `authTables` apporte les tables gérées automatiquement par
  // @convex-dev/auth : authAccounts (identifiants de connexion),
  // authSessions (sessions actives), authRefreshTokens, etc.
  // On ne les manipule jamais directement dans le code métier.
  ...authTables,

  // ------------------------------------------------------------------
  // USERS
  // Table native de @convex-dev/auth, ÉTENDUE avec nos champs métier.
  // On reprend les champs de base (email, etc.) via
  // `authTables.users.validator.fields` puis on ajoute les nôtres.
  // ------------------------------------------------------------------
  users: defineTable({
    ...authTables.users.validator.fields,

    // Rôle applicatif : "admin" voit tout (utilisateurs, cotations,
    // réductions, statistiques) ; "user" travaille sur ses commandes.
    role: v.union(v.literal("admin"), v.literal("user")),

    // Un compte désactivé ne peut plus se connecter, mais n'est jamais
    // supprimé (traçabilité : qui a fait quoi, même après désactivation).
    status: v.union(v.literal("active"), v.literal("disabled")),

    // true tant que l'utilisateur utilise encore le mot de passe
    // temporaire généré à la création du compte - bloque l'accès au
    // reste de l'app jusqu'au changement (cf. SetPasswordGate côté front).
    mustChangePassword: v.boolean(),

    lastLoginAt: v.optional(v.number()), // horodatage de la dernière connexion, pour le dashboard admin
    createdAt: v.number(),
    createdBy: v.optional(v.id("users")), // admin ayant créé le compte (absent pour le tout premier admin, créé par bootstrap)
    disabledAt: v.optional(v.number()),
    disabledBy: v.optional(v.id("users")),
  })
    // Index requis par @convex-dev/auth pour retrouver un compte par email
    // lors de la connexion (le nom "email" n'est pas arbitraire).
    .index("email", ["email"]),

  // ------------------------------------------------------------------
  // PAYS
  // Référentiel des pays de cotation. Le prix d'un produit dépend
  // toujours du pays (cf. `productPrices`) - cette table porte aussi la
  // devise associée, utilisée pour l'affichage et la génération du PDF.
  // ------------------------------------------------------------------
  countries: defineTable({
    code: v.string(), // ex: "CM", "CI" - libre, pas forcément ISO strict
    name: v.string(),
    currency: v.string(),
    active: v.boolean(),
  }).index("by_code", ["code"]),

  // ------------------------------------------------------------------
  // CLIENTS
  // Les entreprises/personnes pour qui on établit des devis.
  // ------------------------------------------------------------------
  clients: defineTable({
    name: v.string(),
    contactEmail: v.optional(v.string()), // pré-remplit le destinataire lors de l'envoi du devis
    contactPhone: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
    // Pays par défaut du client - pré-remplit `orders.countryId` à la
    // création d'une commande, mais n'est pas la source de vérité pour
    // le pricing (c'est toujours celui de la commande qui compte).
    countryId: v.optional(v.id("countries")),
    createdAt: v.number(),
    createdBy: v.id("users"),
    // Suppression douce uniquement : un client lié à des commandes
    // passées ne doit jamais disparaître de l'historique.
    deletedAt: v.optional(v.number()),
  }).index("by_name", ["name"]),

  // ------------------------------------------------------------------
  // CATALOGUE PRODUITS
  // L'IDENTITÉ du produit uniquement (nom, unité, identifiants) - le prix
  // n'est PAS ici : il dépend du pays de cotation et vit dans
  // `productPrices`. C'est avec cette table que chaque ligne d'un
  // document client est comparée (matching).
  // ------------------------------------------------------------------
  products: defineTable({
    impaId: v.optional(v.string()), // identifiant IMPA - clé principale du matching automatique
    code: v.optional(v.string()), // identifiant secondaire (code interne/fournisseur), utilisé si pas d'IMPA
    name: v.string(),
    // Version normalisée du nom (minuscules, sans accents/ponctuation),
    // calculée une fois à l'écriture pour ne pas refaire ce travail à
    // chaque recherche de matching par nom (voir lib/normalize.ts).
    normalizedName: v.string(),
    description: v.optional(v.string()),
    unit: v.string(),
    category: v.optional(v.string()),
    // Un produit désactivé n'apparaît plus dans les recherches/matching
    // mais reste visible dans l'historique des commandes qui l'utilisent.
    active: v.boolean(),
    createdAt: v.number(),
    createdBy: v.id("users"),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
    deletedAt: v.optional(v.number()),
    // D'où vient ce produit : saisi à la main par un admin, ou créé
    // automatiquement lors de la validation d'un fichier fournisseur.
    source: v.union(v.literal("manual"), v.literal("supplier_import")),
    sourceOrderId: v.optional(v.id("orders")), // si issu d'un import fournisseur, la commande d'origine
  })
    .index("by_impaId", ["impaId"]) // matching prioritaire (priorité 1 de l'algorithme)
    .index("by_code", ["code"]) // matching secondaire (priorité 2)
    .index("by_normalizedName", ["normalizedName"])
    .index("by_active", ["active"])
    // Index de recherche plein-texte utilisé pour le matching par nom
    // (priorité 4, uniquement quand le client n'a fourni aucun code).
    .searchIndex("search_name", { searchField: "normalizedName" }),

  // ------------------------------------------------------------------
  // ALIAS PRODUITS
  // Libellés alternatifs sous lesquels un client peut désigner un
  // produit du catalogue (ex: "Marine gas oil filter" pour
  // "Filtre MGO 8 microns"). Alimentée automatiquement à chaque
  // confirmation manuelle/ambiguë - sert de raccourci de matching
  // (priorité 2bis, avant le flou par nom) pour que le système
  // "apprenne" les libellés récurrents au fil des commandes.
  // ------------------------------------------------------------------
  productAliases: defineTable({
    productId: v.id("products"),
    alias: v.string(),
    normalizedAlias: v.string(),
    createdAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_product", ["productId"])
    .index("by_normalizedAlias", ["normalizedAlias"]),

  // ------------------------------------------------------------------
  // PRIX PRODUITS (par pays)
  // Le prix dépend toujours du pays de cotation. Un changement de prix
  // NE remplace PAS la ligne existante : on clôture l'ancienne
  // (`validTo`) et on en insère une nouvelle (`validTo` vide = prix en
  // vigueur). Ça permet de reconstituer le prix exact au moment d'un
  // devis passé, sans dépendre du journal d'audit.
  // ------------------------------------------------------------------
  productPrices: defineTable({
    productId: v.id("products"),
    countryId: v.id("countries"),
    price: v.number(), // prix interne, AVANT application de la cotation (%)
    currency: v.string(),
    validFrom: v.number(),
    validTo: v.optional(v.number()), // vide = prix actuellement en vigueur
    createdBy: v.id("users"),
  })
    .index("by_product", ["productId"])
    // Prix courant d'un produit pour un pays donné : filtrer côté code
    // sur validTo === undefined parmi les résultats de cet index.
    .index("by_product_country", ["productId", "countryId"]),

  // ------------------------------------------------------------------
  // COMMANDES
  // Une commande = une session de traitement d'un document client,
  // persistante : l'utilisateur peut la quitter et la reprendre plus tard.
  // ------------------------------------------------------------------
  orders: defineTable({
    reference: v.string(), // généré automatiquement (ex: "Q-2026-0001"), jamais modifiable par l'utilisateur
    clientId: v.id("clients"),
    clientOrderNumber: v.optional(v.string()), // numéro de commande donné par le client lui-même (facultatif)
    // Pays de cotation, choisi à la création et FIGÉ ensuite : tout le
    // pricing de la commande (matching de prix, devise du devis) en
    // dépend, donc le changer en cours de traitement obligerait à
    // recalculer toutes les lignes déjà validées.
    countryId: v.id("countries"),
    vessel: v.optional(v.string()), // nom du navire
    eta: v.optional(v.string()), // date d'arrivée estimée, format ISO "YYYY-MM-DD"
    // Informations du bloc d'en-tête du document client (hors tableau), conservées pour pouvoir
    // reconstituer le fichier : tout est modifiable depuis la fiche de la quotation.
    documentInfo: v.optional(
      v.object({
        issuer: v.optional(v.string()), // bloc d'adresse / papier à en-tête de l'expéditeur
        instructions: v.optional(v.string()), // consignes de réponse du document
        enquiryDate: v.optional(v.string()),
        enquiryTo: v.optional(v.string()),
        replyBy: v.optional(v.string()),
        imoNo: v.optional(v.string()),
        country: v.optional(v.string()),
        category: v.optional(v.string()),
        department: v.optional(v.string()),
        vendorRef: v.optional(v.string()),
        paymentDays: v.optional(v.string()),
        currency: v.optional(v.string()),
      }),
    ),
    supplyPlace: v.optional(v.string()), // port/lieu de livraison
    // Cycle de vie complet d'une commande, voir §2 du cahier des charges.
    status: v.union(
      v.literal("draft"), // créée, aucun document importé
      v.literal("processing"), // document client importé, articles en cours de traitement/matching
      v.literal("awaiting_supplier"), // en attente du fichier rempli par le fournisseur
      v.literal("po"), // le client a approuvé la demande (bon de commande reçu)
      v.literal("completed"), // tous les articles nécessaires sont connus, devis généré
      v.literal("sent"), // devis envoyé au client par email
      v.literal("archived"),
    ),
    // Cotation (%) spécifique à cette commande. Si absente, on applique
    // la cotation par défaut définie par l'admin (table `settings`).
    quotationPercentOverride: v.optional(v.number()),
    // Réduction globale (%) appliquée par l'admin sur le devis final,
    // en plus des éventuelles remises ligne par ligne.
    globalDiscountPercent: v.optional(v.number()),
    createdAt: v.number(),
    createdBy: v.id("users"),
    updatedAt: v.number(),
    sentAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"]) // pour la liste filtrée par statut
    .index("by_client", ["clientId"])
    .index("by_createdBy", ["createdBy"]) // pour "mes commandes"
    .index("by_reference", ["reference"]),

  // ------------------------------------------------------------------
  // LIGNES DE COMMANDE
  // Une ligne par article du document client. RÈGLE ABSOLUE : une ligne
  // n'est jamais supprimée sous prétexte qu'elle ne matche aucun produit
  // - elle reste visible dans la section "non répertoriés".
  // ------------------------------------------------------------------
  orderItems: defineTable({
    orderId: v.id("orders"),
    lineNo: v.number(), // ordre d'origine dans le document, pour garder le même affichage

    // --- Données brutes telles qu'extraites du document, jamais écrasées ---
    rawCode: v.optional(v.string()), // IMPA/ID tel que fourni par le client (peut être absent ou erroné)
    rawDescription: v.string(),
    rawQuantity: v.optional(v.number()),
    rawUnit: v.optional(v.string()),
    rawOrigin: v.optional(v.string()),
    reqNotes: v.optional(v.string()),
    enqNotes: v.optional(v.string()),

    // --- Résultat du matching (voir lib/matching.ts) ---
    productId: v.optional(v.id("products")), // vide tant que la ligne n'est pas matchée
    matchStatus: v.union(
      v.literal("matched_impa"), // correspondance exacte par IMPA/code - fiabilité maximale
      v.literal("matched_name"), // correspondance par nom, score au-dessus du seuil d'auto-acceptation
      v.literal("ambiguous"), // plusieurs candidats proches par nom - confirmation utilisateur requise
      v.literal("unmatched"), // aucune correspondance trouvée
      v.literal("manual"), // matché à la main par l'utilisateur (confirmation d'une proposition ambiguë ou choix libre)
    ),
    matchConfidence: v.optional(v.number()), // score de similarité (0 à 1) pour matched_name
    ambiguousCandidates: v.optional(v.array(v.id("products"))), // propositions à confirmer quand matchStatus = "ambiguous"

    // --- Historique complet du calcul de prix (§6 du cahier des charges) ---
    // Le produit peut être identifié (productId défini) sans qu'aucun
    // prix n'existe pour le pays de la commande : dans ce cas
    // unitPriceOriginal reste vide ("prix manquant" côté UI) jusqu'à ce
    // qu'un admin ajoute le prix - la ligne se complète alors
    // automatiquement (temps réel), sans repasser par le matching.
    unitPriceOriginal: v.optional(v.number()), // prix catalogue (pour le pays de la commande) au moment du matching
    quotationPercentApplied: v.optional(v.number()), // % de cotation effectivement appliqué à cette ligne
    priceAfterQuotation: v.optional(v.number()), // prix après cotation, avant remise ligne
    lineDiscountPercent: v.optional(v.number()), // remise propre à cette ligne
    finalUnitPrice: v.optional(v.number()), // prix unitaire final (après cotation + remise)
    quotedQuantity: v.optional(v.number()), // quantité retenue pour le devis (modifiable, distincte de rawQuantity)
    // Prix unitaire saisi à la main ou lu dans le fichier (colonne "Unit Price") : il prime sur le prix catalogue
    // et la cotation n'y est pas appliquée. Vide = prix du catalogue pour le pays de la commande.
    unitPriceManual: v.optional(v.number()),
    // Ligne décochée par l'utilisateur : elle n'entre ni dans les totaux/statistiques, ni dans le devis ou le fichier exporté.
    excluded: v.optional(v.boolean()),
    // Cotation propre à la ligne (colonne "Cotation") : prime sur celle de la commande. Vide = cotation de la commande.
    quotationPercentLine: v.optional(v.number()),
    total: v.optional(v.number()), // finalUnitPrice × quotedQuantity

    createdAt: v.number(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("users")),
  })
    .index("by_order", ["orderId"])
    .index("by_product", ["productId"])
    // Index composé : permet de lister uniquement les lignes "unmatched"
    // ou "ambiguous" d'une commande sans charger toutes les lignes
    // (utilisé pour le re-matching après ajout d'un produit au catalogue).
    .index("by_order_and_status", ["orderId", "matchStatus"]),

  // ------------------------------------------------------------------
  // FICHIERS UPLOADÉS
  // Tout fichier qui transite par l'app : import client/fournisseur,
  // mais aussi les fichiers qu'on génère nous-mêmes (template, PDF final).
  // Le contenu réel est dans Convex File Storage ; ici on ne garde que
  // la référence (`storageId`) et les métadonnées.
  // ------------------------------------------------------------------
  uploadedFiles: defineTable({
    orderId: v.id("orders"),
    kind: v.union(
      v.literal("client_request"), // document envoyé par le client
      v.literal("supplier_response"), // fichier rempli par le fournisseur
      v.literal("generated_supplier_template"), // template Excel qu'on a généré pour le fournisseur
      v.literal("generated_quotation"), // PDF du devis final (réservé, généré via `quotations.pdfStorageId` en pratique)
    ),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    // Suivi du pipeline Upload → Extraction → Normalisation (§22).
    // L'UI affiche cet état en temps réel pendant que l'action
    // d'extraction tourne en arrière-plan.
    status: v.union(
      v.literal("uploaded"), // fichier reçu, extraction pas encore lancée
      v.literal("extracting"), // extraction en cours
      v.literal("extracted"), // lignes extraites et enregistrées avec succès
      v.literal("error"), // échec (ex: PDF scanné sans texte exploitable)
    ),
    extractionError: v.optional(v.string()), // message d'erreur lisible, affiché à l'utilisateur
    uploadedBy: v.id("users"),
    uploadedAt: v.number(),
  })
    .index("by_order", ["orderId"])
    .index("by_order_and_kind", ["orderId", "kind"]),

  // ------------------------------------------------------------------
  // STAGING FOURNISSEUR
  // Zone de transit entre "fichier fournisseur importé" et "produit
  // enregistré au catalogue". Rien n'atterrit dans `products` sans passer
  // par une validation humaine sur ces lignes (§8 du cahier des charges).
  // ------------------------------------------------------------------
  supplierItems: defineTable({
    orderId: v.id("orders"),
    uploadedFileId: v.id("uploadedFiles"), // fichier fournisseur dont cette ligne est issue
    orderItemId: v.optional(v.id("orderItems")), // ligne "non répertoriée" d'origine, si on a pu la relier
    rawCode: v.optional(v.string()),
    rawName: v.string(),
    rawDescription: v.optional(v.string()),
    rawUnit: v.optional(v.string()),
    rawPrice: v.optional(v.number()),
    status: v.union(
      v.literal("pending_validation"), // en attente de relecture/correction par l'utilisateur
      v.literal("validated"), // enregistrée dans `products`
      v.literal("rejected"), // écartée par l'utilisateur
      v.literal("duplicate"), // un produit avec ce code existe déjà - pas de création automatique
    ),
    duplicateOfProductId: v.optional(v.id("products")), // référence du produit existant si status = "duplicate"
    validatedBy: v.optional(v.id("users")),
    validatedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_order", ["orderId"])
    .index("by_file", ["uploadedFileId"]),

  // ------------------------------------------------------------------
  // QUOTATIONS
  // Un devis généré est une PHOTO figée des lignes au moment de la
  // génération (`snapshotItems`), indépendante des évolutions futures
  // des `orderItems` - on peut régénérer une nouvelle version sans
  // jamais modifier les précédentes (traçabilité des envois passés).
  // ------------------------------------------------------------------
  quotations: defineTable({
    orderId: v.id("orders"),
    version: v.number(), // incrémenté à chaque régénération pour la même commande
    snapshotItems: v.array(
      v.object({
        description: v.string(),
        code: v.optional(v.string()),
        unit: v.string(),
        quantity: v.number(),
        unitPrice: v.number(),
        discountPercent: v.number(),
        finalPrice: v.number(),
        total: v.number(),
      }),
    ),
    grandTotal: v.number(),
    pdfStorageId: v.optional(v.id("_storage")), // référence vers le PDF généré dans Convex Storage
    generatedAt: v.number(),
    generatedBy: v.id("users"),
    // Validation optionnelle par un admin avant envoi (§17).
    approvedByAdmin: v.optional(v.boolean()),
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
  }).index("by_order", ["orderId"]),

  // ------------------------------------------------------------------
  // HISTORIQUE DES EMAILS
  // ------------------------------------------------------------------
  emailLogs: defineTable({
    orderId: v.id("orders"),
    quotationId: v.id("quotations"), // quelle version du devis a été envoyée
    to: v.string(),
    subject: v.string(),
    message: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    providerMessageId: v.optional(v.string()), // identifiant renvoyé par Brevo, utile pour le support
    errorMessage: v.optional(v.string()),
    sentBy: v.id("users"),
    sentAt: v.number(),
  }).index("by_order", ["orderId"]),

  // ------------------------------------------------------------------
  // JOURNAL D'ACTIVITÉ (AUDIT)
  // Table générique : `entityType` + `entityId` sont de simples chaînes
  // de texte plutôt que de vraies relations, volontairement, pour
  // pouvoir journaliser n'importe quel type d'action (y compris sur des
  // entités qui n'existent plus) sans faire exploser le schéma.
  // ------------------------------------------------------------------
  activityLogs: defineTable({
    userId: v.optional(v.id("users")), // absent pour une action système (ex: bootstrap du premier admin)
    action: v.string(), // ex: "order.created", "product.price_updated"
    entityType: v.string(), // ex: "order", "product", "user"
    entityId: v.optional(v.string()),
    metadata: v.optional(v.any()), // détail libre (ex: {oldPrice, newPrice}), pour reconstituer l'historique d'une modification
    createdAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_entity", ["entityType", "entityId"])
    .index("by_action", ["action", "createdAt"]),

  // ------------------------------------------------------------------
  // TOKENS DE RÉINITIALISATION DE MOT DE PASSE
  // Flux "mot de passe oublié" maison (indépendant de
  // @convex-dev/auth) : un token à usage unique, à durée de vie limitée,
  // dont seul le hash est stocké (jamais le token en clair).
  // ------------------------------------------------------------------
  passwordResetTokens: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()), // empêche la réutilisation du même lien
    createdAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_user", ["userId"]),

  // ------------------------------------------------------------------
  // PARAMÈTRES GLOBAUX
  // Table clé/valeur générique plutôt qu'une table à colonnes fixes :
  // permet d'ajouter de nouveaux réglages (cotation par défaut, devise,
  // infos entreprise...) sans migration de schéma.
  // ------------------------------------------------------------------
  settings: defineTable({
    key: v.string(), // ex: "defaultQuotationPercent", "companyInfo" - la devise vient du pays (table `countries`), pas d'un setting global
    value: v.any(),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
  }).index("by_key", ["key"]),
});

export default schema;
