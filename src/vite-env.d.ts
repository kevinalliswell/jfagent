/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SESSION_API_MODE?: "mock" | "backend";
  readonly VITE_API_BASE_URL?: string | "same-origin";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
