// Narrow native contracts verified by runtime probes on Aphrody 169d8c5ea.
// Parsing is inert: no BrowserRealm or page scripts are evaluated.
export {};
declare global {
  namespace Bun {
    const HTML: {
      parse(html: string): {
        select(selector: string): number[];
        text(node: number): string;
        attribute(node: number, name: string): string | null;
      };
      parseCSS(css: string): { prelude: string; body: string }[];
    };
  }
}
