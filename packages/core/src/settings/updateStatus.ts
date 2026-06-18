export interface RawUpdateStatus {
  checking?: boolean;
  downloading?: boolean;
  upToDate?: boolean;
  updateReady?: boolean;
  version?: string;
}

export interface DerivedUpdateStatus {
  message?: string;
  type?: "info" | "success" | "error";
  checking?: boolean;
}

export function deriveUpdateStatus(
  status: RawUpdateStatus,
): DerivedUpdateStatus {
  if (status.checking && status.downloading) {
    return { message: "Downloading update...", type: "info", checking: true };
  }
  if (status.checking === false && status.upToDate) {
    return {
      message: "You're on the latest version",
      type: "success",
      checking: false,
    };
  }
  if (status.checking === false && status.updateReady) {
    return {
      message: status.version
        ? `Update ${status.version} ready to install`
        : "Update ready to install",
      type: "success",
      checking: false,
    };
  }
  if (status.checking === false) {
    return { checking: false };
  }
  return {};
}
