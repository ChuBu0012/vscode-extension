import * as vscode from 'vscode';

export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class VsCodeSecretStore implements SecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.secrets.store(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.secrets.delete(key);
  }
}

export function providerSecretKey(providerId: string): string {
  if (providerId.startsWith('custom:')) {
    return `quotadeck.secret.${providerId.slice('custom:'.length)}`;
  }
  return `quotadeck.key.${providerId}`;
}
