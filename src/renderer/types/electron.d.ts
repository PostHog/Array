export interface IElectronAPI {
  storeApiKey: (apiKey: string) => Promise<string>;
  retrieveApiKey: (encryptedKey: string) => Promise<string | null>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}