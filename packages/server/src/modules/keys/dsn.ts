import { env } from "../../config/env.js";

export const buildDsn = (publicKey: string, projectId: string): string =>
  `${env.DSN_SCHEME}://${publicKey}@${env.DSN_HOST}/${projectId}`;
