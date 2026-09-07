declare module "cloudflare:workers" {
  // Runtime binding shape is supplied by Cloudflare; `any` keeps the optional
  // Sites database helper from blocking standard Next.js hosts such as Netlify.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const env: Record<string, any>;
}
