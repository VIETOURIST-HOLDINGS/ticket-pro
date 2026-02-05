import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Download, Loader2, FileImage, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Image from "next/image";

interface QRCodeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: string;
  rowData?: Record<string, any>;
}

export function QRCodeModal({ open, onOpenChange, data, rowData }: QRCodeModalProps) {
  const { toast } = useToast();
  const [ticketImageUrl, setTicketImageUrl] = React.useState<string>('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [imageError, setImageError] = React.useState(false);
  const [generationTime, setGenerationTime] = React.useState<number>(0);

  // Clean up URLs
  const cleanupUrls = React.useCallback(() => {
    if (ticketImageUrl) {
      URL.revokeObjectURL(ticketImageUrl);
      setTicketImageUrl('');
    }
  }, [ticketImageUrl]);

  React.useEffect(() => {
    if (data && open) {
      generateTicketPreview();
    } else {
      cleanupUrls();
    }
  }, [data, open]);

  React.useEffect(() => {
    return () => {
      cleanupUrls();
    };
  }, [cleanupUrls]);

  const generateTicketPreview = async () => {
    if (!data) return;

    setIsLoading(true);
    setImageError(false);
    const startTime = performance.now();

    try {
      const response = await fetch('/api/generate-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qrData: data,
          rowData,
          format: 'jpg',
          preview: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error ||
          errorData.details ||
          `Failed to generate ticket: ${response.statusText}`
        );
      }

      // Create blob URL for the image
      const blob = await response.blob();

      // Calculate generation time
      const endTime = performance.now();
      setGenerationTime(Math.round(endTime - startTime));

      // Revoke previous URL if exists
      cleanupUrls();

      const url = URL.createObjectURL(blob);
      setTicketImageUrl(url);

      // Auto-revoke URL after 5 minutes for memory management
      setTimeout(() => {
        if (ticketImageUrl === url) {
          cleanupUrls();
        }
      }, 5 * 60 * 1000);

    } catch (error: any) {
      console.error('Failed to generate ticket preview:', error);
      setImageError(true);
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate ticket preview",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyData = async () => {
    try {
      await navigator.clipboard.writeText(data);
      toast({
        title: "Copied!",
        description: "QR code data copied to clipboard",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleDownloadTicket = async () => {
    if (!data) return;

    try {
      setIsLoading(true);
      const startTime = performance.now();

      const response = await fetch('/api/generate-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qrData: data,
          rowData,
          format: 'jpg',
          quality: 100,
          download: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }

      // Get filename from headers or generate
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `ticket-${Date.now()}.jpg`;

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+?)"/);
        if (filenameMatch?.[1]) {
          filename = filenameMatch[1];
        }
      }

      // Create download
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up
      setTimeout(() => URL.revokeObjectURL(url), 100);

      // Log performance
      const endTime = performance.now();
      console.log(`Download generation time: ${Math.round(endTime - startTime)}ms`);

      toast({
        title: "Download Started",
        description: `Ticket saved as ${filename}`,
      });
    } catch (error: any) {
      console.error('Failed to download ticket:', error);
      toast({
        title: "Download Failed",
        description: error.message || "Failed to download ticket",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = () => {
    setImageError(false);
    generateTicketPreview();
  };

  const handleRegenerate = () => {
    generateTicketPreview();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileImage className="h-5 w-5" />
            Ticket Preview
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center space-y-4 overflow-y-auto max-h-[calc(90vh-120px)] p-1">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-64">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <span className="text-muted-foreground">Generating ticket preview...</span>
            </div>
          ) : imageError ? (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
              <div className="text-center">
                <p className="text-destructive font-medium mb-2">Failed to generate preview</p>
                <p className="text-sm text-muted-foreground">Please check your data and try again</p>
              </div>
              <Button onClick={handleRetry} variant="outline" className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Retry Generation
              </Button>
            </div>
          ) : ticketImageUrl ? (
            <>
              <div className="w-full border rounded-lg overflow-hidden bg-muted/50">
                <div className="relative w-full aspect-[3/4] min-h-[400px] max-h-[500px]">
                  <Image
                    src={ticketImageUrl}
                    alt="Ticket Preview"
                    fill
                    className="object-contain p-4"
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    onError={() => setImageError(true)}
                    priority
                  />
                </div>
              </div>

              {generationTime > 0 && (
                <div className="flex items-center justify-between w-full text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRegenerate}
                      className="h-7 text-xs"
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Regenerate
                    </Button>
                  </div>
                  <span>Generated in {generationTime}ms</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <FileImage className="h-12 w-12 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground">No ticket preview available</p>
              <p className="text-sm text-muted-foreground mt-1">
                Enter QR code data to generate a ticket
              </p>
            </div>
          )}

          <div className="w-full space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">QR Code Data:</p>
              <span className="text-xs text-muted-foreground">
                {data ? `${data.length} characters` : 'Empty'}
              </span>
            </div>
            <div className="relative">
              <pre className="text-sm font-mono bg-muted p-4 rounded-lg border overflow-x-auto whitespace-pre-wrap break-all max-h-32">
                {data || "No data provided"}
              </pre>
              {data && (
                <div className="absolute top-2 right-2 flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyData}
                    className="h-7 w-7 p-0 bg-background/80 backdrop-blur-sm"
                    title="Copy data"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 w-full">
            <Button
              variant="outline"
              onClick={handleCopyData}
              className="flex-1"
              disabled={!data}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy Data
            </Button>
            <Button
              onClick={handleDownloadTicket}
              className="flex-1"
              disabled={!data || isLoading}
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download Ticket
            </Button>
          </div>

          <div className="w-full pt-2">
            <div className="text-xs text-muted-foreground text-center space-y-1">
              <p>Ticket will be generated as high-quality JPG image</p>
              <p className="text-[10px]">Ensure your template file exists at: /public/ticket-template.jpg</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}