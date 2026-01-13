import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface FileUploaderProps {
  onFileSelect: (file: File | null) => void;
  selectedFile: File | null;
  error?: string;
}

export function FileUploader({ onFileSelect, selectedFile, error }: FileUploaderProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onFileSelect(acceptedFiles[0]);
      }
    },
    [onFileSelect]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/plain": [".txt"],
    },
    maxFiles: 1,
    multiple: false,
  });

  const removeFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFileSelect(null);
  };

  return (
    <div className="w-full">
      <AnimatePresence mode="wait">
        {!selectedFile ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            {...getRootProps()}
            className={cn(
              "relative cursor-pointer rounded-xl border-2 border-dashed p-10 transition-all duration-300 ease-out hover:border-primary/50 hover:bg-primary/5",
              isDragActive
                ? "border-primary bg-primary/10 scale-[1.02]"
                : "border-border bg-card/50",
              error ? "border-destructive/50 bg-destructive/5" : ""
            )}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center justify-center text-center space-y-4">
              <div
                className={cn(
                  "flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform duration-300",
                  isDragActive ? "scale-110" : ""
                )}
              >
                <Upload className="h-8 w-8" />
              </div>
              <div className="space-y-1">
                <p className="text-lg font-medium text-foreground">
                  {isDragActive ? "Drop your file here" : "Upload your contact list"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Drag & drop or click to select a .txt file
                </p>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 p-4 shadow-sm"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <p className="font-medium text-foreground">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(selectedFile.size / 1024).toFixed(2)} KB
                </p>
              </div>
            </div>
            <button
              onClick={removeFile}
              className="rounded-full p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      
      {error && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-2 text-sm text-destructive font-medium"
        >
          {error}
        </motion.p>
      )}
    </div>
  );
}
