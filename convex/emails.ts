import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { arrayBufferToBase64 } from "./lib/base64";
import { sendTransactionalEmail } from "./lib/brevo";

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";

export const sendWelcomeEmail = internalAction({
  args: { userId: v.id("users"), email: v.string(), tempPassword: v.string() },
  handler: async (_ctx, { email, tempPassword }) => {
    await sendTransactionalEmail({
      to: email,
      subject: "Votre compte a été créé",
      htmlContent: `
        <p>Bonjour,</p>
        <p>Un compte vient d'être créé pour vous sur l'application de quotation.</p>
        <p><strong>Email :</strong> ${email}<br/>
           <strong>Mot de passe temporaire :</strong> ${tempPassword}</p>
        <p>Connectez-vous sur <a href="${APP_URL}">${APP_URL}</a> - un nouveau mot de passe vous sera demandé dès la première connexion.</p>
      `,
    });
  },
});

export const sendTempPasswordEmail = internalAction({
  args: { email: v.string(), tempPassword: v.string() },
  handler: async (_ctx, { email, tempPassword }) => {
    await sendTransactionalEmail({
      to: email,
      subject: "Votre mot de passe a été réinitialisé",
      htmlContent: `
        <p>Bonjour,</p>
        <p>Un administrateur a réinitialisé votre mot de passe.</p>
        <p><strong>Mot de passe à usage unique :</strong> ${tempPassword}</p>
        <p>Connectez-vous sur <a href="${APP_URL}">${APP_URL}</a> : un nouveau mot de passe personnel vous sera demandé aussitôt.</p>
      `,
    });
  },
});

export const sendQuotationEmail = action({
  args: {
    orderId: v.id("orders"),
    quotationId: v.id("quotations"),
    to: v.string(),
    subject: v.string(),
    message: v.string(),
  },
  handler: async (ctx, { orderId, quotationId, to, subject, message }) => {
    const user = await ctx.runQuery(api.users.getCurrentUser, {});
    if (!user) throw new Error("Authentification requise.");

    const quotation = await ctx.runQuery(internal.quotations.getQuotationInternal, {
      quotationId,
    });
    if (!quotation || quotation.orderId !== orderId) {
      throw new Error("Quotation introuvable pour cette commande.");
    }
    if (!quotation.pdfStorageId) {
      throw new Error("Le PDF de la quotation n'a pas encore été généré.");
    }

    const blob = await ctx.storage.get(quotation.pdfStorageId);
    if (!blob) throw new Error("Fichier PDF introuvable dans le stockage.");
    const buffer = await blob.arrayBuffer();
    const contentBase64 = arrayBufferToBase64(buffer);

    let status: "sent" | "failed" = "sent";
    let errorMessage: string | undefined;
    let providerMessageId: string | undefined;

    try {
      const result = await sendTransactionalEmail({
        to,
        subject,
        htmlContent: message.replace(/\n/g, "<br/>"),
        attachments: [{ name: "quotation.pdf", contentBase64 }],
      });
      providerMessageId = result.messageId;
    } catch (err) {
      status = "failed";
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    await ctx.runMutation(internal.quotations.recordEmailSentInternal, {
      orderId,
      quotationId,
      to,
      subject,
      message,
      status,
      providerMessageId,
      errorMessage,
      sentBy: user._id,
    });

    if (status === "failed") {
      throw new Error(errorMessage ?? "Échec de l'envoi de l'email.");
    }
  },
});
