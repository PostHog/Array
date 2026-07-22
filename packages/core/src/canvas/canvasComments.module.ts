import { ContainerModule } from "inversify";
import {
  CANVAS_COMMENTS_SERVICE,
  CanvasCommentsService,
} from "./canvasCommentsService";

export const canvasCommentsCoreModule = new ContainerModule(({ bind }) => {
  bind(CanvasCommentsService).toSelf().inSingletonScope();
  bind(CANVAS_COMMENTS_SERVICE).toService(CanvasCommentsService);
});
