import type { Container, ServiceIdentifier } from "inversify";

let rootContainer: Container | null = null;
const pendingBindings: Array<(container: Container) => void> = [];

export function setRootContainer(container: Container): void {
  rootContainer = container;
  for (const bind of pendingBindings) {
    bind(container);
  }
  pendingBindings.length = 0;
}

export function bindToContainer(bind: (container: Container) => void): void {
  if (rootContainer) {
    bind(rootContainer);
  } else {
    pendingBindings.push(bind);
  }
}

export function resolveService<T>(serviceIdentifier: ServiceIdentifier<T>): T {
  if (!rootContainer) {
    throw new Error(
      "resolveService called before setRootContainer; the root container is not initialized",
    );
  }

  return rootContainer.get<T>(serviceIdentifier);
}

export function resolveServiceOptional<T>(
  serviceIdentifier: ServiceIdentifier<T>,
): T | null {
  if (!rootContainer || !rootContainer.isBound(serviceIdentifier)) {
    return null;
  }

  return rootContainer.get<T>(serviceIdentifier);
}
