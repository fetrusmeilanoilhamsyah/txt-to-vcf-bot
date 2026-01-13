import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { conversionConfigSchema, type ConversionConfig } from "@shared/schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FileUploader } from "./FileUploader";
import { useState } from "react";
import { Loader2, Download, Settings, RefreshCw } from "lucide-react";
import { useConvertFile } from "@/hooks/use-convert";

export function ConverterForm() {
  const [file, setFile] = useState<File | null>(null);
  const convertMutation = useConvertFile();

  const form = useForm<ConversionConfig>({
    resolver: zodResolver(conversionConfigSchema),
    defaultValues: {
      contactName: "Contact",
      fileName: "contacts",
      splitLimit: 100,
    },
  });

  // Clear cache on component mount to prevent showing old data
  if (typeof window !== 'undefined') {
    // Ensure form always starts fresh
    if (!form.formState.isDirty && !file) {
      form.reset({
        contactName: "Contact",
        fileName: "contacts",
        splitLimit: 100,
      });
    }
  }

  const onSubmit = (data: ConversionConfig) => {
    if (!file) {
      form.setError("root", { message: "Please upload a file first" });
      return;
    }
    
    convertMutation.mutate({
      file,
      ...data,
    });
  };

  const resetForm = () => {
    form.reset();
    setFile(null);
    convertMutation.reset();
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-8">
      <div className="bg-card rounded-2xl p-6 md:p-8 shadow-xl border border-border/50">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            
            {/* File Upload Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm">1</span>
                Upload Source File
              </h3>
              <FileUploader 
                onFileSelect={(f) => {
                  setFile(f);
                  form.clearErrors("root");
                }} 
                selectedFile={file}
                error={form.formState.errors.root?.message}
              />
            </div>

            <div className="h-px bg-border/50" />

            {/* Configuration Section */}
            <div className="space-y-6">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm">2</span>
                Configuration
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="contactName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Name Prefix</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Customer" {...field} className="bg-background/50" />
                      </FormControl>
                      <FormDescription>Used for naming contacts (e.g. Customer 1)</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="fileName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Output Filename</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. my-contacts" {...field} className="bg-background/50" />
                      </FormControl>
                      <FormDescription>Name of the resulting .vcf or .zip file</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="splitLimit"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Contacts Per File (Split Limit)</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Settings className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                          <Input 
                            type="number" 
                            min={1} 
                            placeholder="100" 
                            {...field} 
                            className="pl-10 bg-background/50" 
                          />
                        </div>
                      </FormControl>
                      <FormDescription>
                        Files will be split if they exceed this number of contacts.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-4 flex flex-col sm:flex-row gap-4">
              <Button 
                type="submit" 
                size="lg" 
                className="flex-1 bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 shadow-lg shadow-primary/25"
                disabled={convertMutation.isPending}
              >
                {convertMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Converting...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-5 w-5" />
                    Convert & Download
                  </>
                )}
              </Button>

              {convertMutation.isSuccess && (
                <Button 
                  type="button" 
                  variant="outline" 
                  size="lg"
                  onClick={resetForm}
                  className="border-primary/20 text-primary hover:bg-primary/5"
                >
                  <RefreshCw className="mr-2 h-5 w-5" />
                  Convert Another
                </Button>
              )}
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
