// jsdom ships no types and the project adds no dependency for them: this is the little of it the export tests use
// (a page opened from text, with its scripts run).
declare module 'jsdom' {
  export class JSDOM {
    constructor(
      html: string,
      options?: {
        runScripts?: 'dangerously' | 'outside-only';
        url?: string;
        pretendToBeVisual?: boolean;
        beforeParse?: (window: Window & typeof globalThis) => void;
      },
    );
    readonly window: Window & typeof globalThis;
  }
}
