// Types for csp.mjs, for vite.config.ts and the test that reads the policy.
import type { Plugin } from 'vite';
export const CONNECT_HOSTS: string[];
/** The policy as [directive, ...sources] rows. */
export interface CspOptions { /** the single-.html build: its fonts are data: addresses the app reads back */ oneFile?: boolean }
export function cspDirectives(scriptHashes?: string[], options?: CspOptions): string[][];
export function contentSecurityPolicy(scriptHashes?: string[], options?: CspOptions): string;
export function inlineScripts(html: string): string[];
export function scriptHash(text: string): string;
export function withCsp(html: string, options?: CspOptions): string;
export function cspPlugin(options?: CspOptions): Plugin;
