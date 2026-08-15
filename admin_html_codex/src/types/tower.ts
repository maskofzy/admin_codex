export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }

export interface TowerConfigRecord {
  id: string;
  revision: string;
  version: string | null;
  remark: string;
  config: JsonObject;
}

export interface TowerConfigDocument {
  main: TowerConfigRecord;
  welfare: TowerConfigRecord | null;
}

export interface TowerAnchor {
  open_uid: string;
  nickname: string;
  config_id: string | null;
}

export interface TowerRecovery {
  id: string;
  open_uid: string;
  nickname: string;
  config: JsonObject;
  is_used: boolean;
  created_at: string;
}

export interface TowerAnchorListResponse {
  items: TowerAnchor[];
}

export interface TowerRecoveryListResponse {
  items: TowerRecovery[];
}
