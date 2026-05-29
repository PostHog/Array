import "reflect-metadata";
import { Container } from "inversify";
import { ConnectivityService } from "../services/connectivity/service";
import { EnvironmentService } from "../services/environment/service";
import { FocusService } from "../services/focus/service";
import { FocusSyncService } from "../services/focus/sync-service";
import { FsService } from "../services/fs/service";
import { GitService } from "../services/git/service";
import { LOGS_SERVICE } from "../services/local-logs/identifiers";
import { LocalLogsService } from "../services/local-logs/service";
import { WatcherService } from "../services/watcher/service";
import { TOKENS } from "./tokens";

export const container = new Container();
container.bind(TOKENS.FocusService).to(FocusService).inSingletonScope();
container.bind(TOKENS.FocusSyncService).to(FocusSyncService).inSingletonScope();
container.bind(TOKENS.GitService).to(GitService).inSingletonScope();
container.bind(TOKENS.FsService).to(FsService).inSingletonScope();
container.bind(TOKENS.WatcherService).to(WatcherService).inSingletonScope();
container.bind(TOKENS.LocalLogsService).to(LocalLogsService).inSingletonScope();
container.bind(LOGS_SERVICE).toService(TOKENS.LocalLogsService);
container
  .bind(TOKENS.ConnectivityService)
  .to(ConnectivityService)
  .inSingletonScope();
container
  .bind(TOKENS.EnvironmentService)
  .to(EnvironmentService)
  .inSingletonScope();
