export {};

declare global {
  interface ReceiptOCROptions {
    quality?: 'photo' | 'fast';
    maxDimension?: number;
    pageSegMode?: 3 | 6 | 11;
    dateOrder?: 'MDY' | 'DMY';
    debug?: boolean;
    onProgress?: (event: { status: string; progress: number }) => void;
  }
  interface ReceiptOCRResult {
    rawText: string;
    merchant: string | null;
    date: string | null;
    dateRaw: string | null;
    currency: string | null;
    currencySymbol: string | null;
    currencyFamily: 'dollar' | 'pound' | 'euro' | 'yen' | 'yuan' | 'yen-or-yuan' | 'won' | 'peso' | null;
    total: number | null;
    subtotal: number | null;
    tax: number | null;
    tip: number | null;
    serviceCharge: number | null;
    discount: number | null;
    warnings: string[];
    needsReview: true;
    evidence: Record<string, unknown>;
    arithmeticMatches?: boolean;
    confidence?: number;
    fieldConfidence?: Record<string, number>;
    processingMs?: number;
    pass?: string;
    preprocessing?: { paperCrop: { left: number; top: number; right: number; bottom: number } | null; deskewDegrees: number };
    attempts?: Array<{ pass: string; confidence: number; total: number | null; tax: number | null; merchant: string | null; date: string | null; score: number; rawText?: string }>;
    items: Array<{ description: string; quantity: number | null; amount: number; lineNumber: number; rawLine: string }>;
    taxLines: Array<{ label: string; amount: number; lineNumber: number; rawLine: string }>;
  }
  var ReceiptOCR: {
    readonly info: Readonly<{ version: string; engine: string; language: string; webAssembly: false; workers: false; runtimeDownloads: false }>;
    init(): Promise<typeof ReceiptOCR.info>;
    dispose(): Promise<void>;
    parse(text: string, options?: Pick<ReceiptOCROptions, 'dateOrder'>): ReceiptOCRResult;
    recognize(input: Blob | string | CanvasImageSource | { width: number; height: number; data: Uint8Array | Uint8ClampedArray }, options?: ReceiptOCROptions): Promise<ReceiptOCRResult>;
  };
}
