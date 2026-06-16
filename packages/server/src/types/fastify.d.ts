import type { preHandlerAsyncHookHandler } from "fastify";

export interface AuthenticatedUser {
  id: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }

  interface FastifyInstance {
    requireAuth: preHandlerAsyncHookHandler;
  }

  interface FastifyContextConfig {
    cors?:
      | false
      | {
          origin?: boolean | string;
          methods?: string[];
          allowedHeaders?: string[];
          credentials?: boolean;
        };
  }
}
