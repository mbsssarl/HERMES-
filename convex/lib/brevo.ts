const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export interface BrevoAttachment {
  name: string;
  contentBase64: string;
}

export interface SendEmailArgs {
  to: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  attachments?: BrevoAttachment[];
}

export interface SendEmailResult {
  messageId: string;
}

/** Sends a transactional email through Brevo. Throws with the API's error message on failure. */
export async function sendTransactionalEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME ?? "Hermès Quotations";

  if (!apiKey || !senderEmail) {
    throw new Error(
      "Configuration Brevo manquante (BREVO_API_KEY / BREVO_SENDER_EMAIL) - voir les variables d'environnement Convex.",
    );
  }

  const response = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: args.to, name: args.toName }],
      subject: args.subject,
      htmlContent: args.htmlContent,
      attachment: args.attachments?.map((a) => ({
        name: a.name,
        content: a.contentBase64,
      })),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Échec de l'envoi Brevo (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { messageId: string };
  return { messageId: data.messageId };
}
