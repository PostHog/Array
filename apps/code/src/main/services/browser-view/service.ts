import { isDevBuild } from "../../utils/env";

class BrowserViewService {
  private enabled = isDevBuild();

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

export const browserViewService = new BrowserViewService();
