import { ContainerModule } from "inversify";
import {
  TASK_FORK_SERVICE,
  TASK_SERVICE,
  WORKSPACE_SETUP_SAGA,
} from "./identifiers";
import { TaskForkService } from "./taskForkService";
import { TaskService } from "./taskService";
import { WorkspaceSetupSaga } from "./workspaceSetupSaga";

export const taskDetailModule = new ContainerModule(({ bind }) => {
  bind(TASK_SERVICE).to(TaskService).inSingletonScope();
  bind(TASK_FORK_SERVICE).to(TaskForkService).inSingletonScope();
  bind(WORKSPACE_SETUP_SAGA).to(WorkspaceSetupSaga).inSingletonScope();
});
