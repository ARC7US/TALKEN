export interface RelayData {
  id: number;
  taskId: string;
  dataType: RelayDataType;
  encryptedContent: string;
  storedBy: string;
  createdAt: string;
}

export type RelayDataType = "brief" | "result";
