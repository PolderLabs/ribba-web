declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}

interface Window {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}
