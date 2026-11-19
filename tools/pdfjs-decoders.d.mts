// Types for pdfjs-decoders.mjs, for vite.config.ts and the test that checks what is shipped.
import type { Plugin } from 'vite';
export const PDFJS_DECODER_DIR: string;
export const PDFJS_DECODER_FILES: string[];
export function pdfjsDecoderSource(): string;
export interface PdfjsDecoderOptions { /** the single-.html build: no files beside it, so none are written */ oneFile?: boolean }
export function pdfjsDecodersPlugin(options?: PdfjsDecoderOptions): Plugin;
