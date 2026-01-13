import { useMutation } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";

// We define the input type manually since it goes into FormData
type ConvertInput = {
  file: File;
  contactName: string;
  fileName: string;
  splitLimit: number;
};

export function useConvertFile() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: ConvertInput) => {
      const formData = new FormData();
      formData.append("file", data.file);
      formData.append("contactName", data.contactName);
      formData.append("fileName", data.fileName);
      formData.append("splitLimit", data.splitLimit.toString());

      const res = await fetch(api.convert.path, {
        method: api.convert.method,
        body: formData,
        // Don't set Content-Type header manually for FormData, let browser handle boundary
      });

      if (!res.ok) {
        let errorMessage = "Conversion failed";
        try {
          const errorData = await res.json();
          errorMessage = errorData.message || errorMessage;
        } catch (e) {
          errorMessage = await res.text();
        }
        throw new Error(errorMessage);
      }

      // Return the blob for downloading
      return res.blob();
    },
    onSuccess: (blob) => {
      // Create a link to download the file
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // We can't know the exact filename from the blob unless the server sends content-disposition
      // But we can guess based on the type or just use a generic name zip/vcf
      const isZip = blob.type === "application/zip";
      a.download = isZip ? "contacts.zip" : "contacts.vcf";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      toast({
        title: "Success!",
        description: "Your file has been converted and download started.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
