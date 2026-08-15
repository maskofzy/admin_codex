export type ProjectCapability =
  | 'leaderboards'
  | 'compensations'
  | 'guilds'
  | 'debug'
  | 'operations'
  | 'tower_config';

export interface GiftCatalogItem {
  id: string;
  name: string;
  value: number;
}

export interface ProjectDefinition {
  id: string;
  name: string;
  authRequired: boolean;
}

export interface ProjectRegistry {
  apiBase: string;
  projects: ProjectDefinition[];
}

export interface AdminContext {
  project_id: string;
  project_name: string;
  platform: 'dy' | 'ks';
  mock_mode: boolean;
  config_key: string;
  capabilities: {
    leaderboards: boolean;
    gift_compensation: boolean;
    guilds: boolean;
    gift_debug: boolean;
    configs: boolean;
    platform_tokens: boolean;
    tower_config: boolean;
  };
  gift_catalog: GiftCatalogItem[];
}
