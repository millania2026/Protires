declare module 'cors' {
  import type { IncomingMessage } from 'node:http';
  import type { RequestHandler } from 'express';
  type CorsOptions = Record<string, unknown>;
  type CorsDelegate = (req: IncomingMessage, callback: (error: Error | null, options?: CorsOptions) => void) => void;
  export default function cors(options?: CorsOptions | CorsDelegate): RequestHandler;
}
