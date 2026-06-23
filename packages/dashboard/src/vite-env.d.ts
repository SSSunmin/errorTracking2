/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Separate origin that serves the replay viewer; empty disables isolation. */
  readonly VITE_REPLAY_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
