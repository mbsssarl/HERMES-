import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export function useFileUpload(orderId: Id<"orders">) {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const registerUploadedFile = useMutation(api.files.registerUploadedFile);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File, kind: "client_request" | "supplier_response") {
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("Échec de l'upload du fichier.");
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };

      await registerUploadedFile({
        orderId,
        storageId,
        kind,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
      });
    } finally {
      setUploading(false);
    }
  }

  return { upload, uploading };
}
