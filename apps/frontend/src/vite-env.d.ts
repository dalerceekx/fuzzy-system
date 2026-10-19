/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ENABLE_MOCK?: string;
  readonly VITE_SHOW_DEMO_ACCOUNTS?: string;
  readonly VITE_DEMO_SUPER_ADMIN_PHONE?: string;
  readonly VITE_DEMO_SUPER_ADMIN_PASSWORD?: string;
  readonly VITE_DEMO_FARMER_PHONE?: string;
  readonly VITE_DEMO_FARMER_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
