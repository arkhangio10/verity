import type { CountryAdapter } from './types';

const registry = new Map<string, CountryAdapter>();

export function registerAdapter(adapter: CountryAdapter): void {
  registry.set(adapter.countryCode.toUpperCase(), adapter);
}

export function getAdapter(countryCode: string): CountryAdapter {
  const adapter = registry.get(countryCode.toUpperCase());
  if (!adapter) {
    throw new Error(
      `no CountryAdapter registered for "${countryCode}" (registered: ${[...registry.keys()].join(', ') || 'none'})`,
    );
  }
  return adapter;
}

export function listAdapters(): CountryAdapter[] {
  return [...registry.values()];
}
