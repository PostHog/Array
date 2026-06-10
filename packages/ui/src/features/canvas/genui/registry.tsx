import { createRenderer } from "@json-render/react";
import {
  BadgeBody,
  BarListBody,
  CardBody,
  DividerBody,
  GridBody,
  HeadingBody,
  PageBody,
  PLAIN_CTX,
  StatBody,
  TableBody,
  TextBody,
} from "@posthog/ui/features/canvas/genui/bodies";
import { canvasCatalog } from "@posthog/ui/features/canvas/genui/catalog";

// View-mode renderer: maps catalog component names to the shared presentational
// bodies (see bodies.tsx). Edit mode reuses the same bodies via EditRenderer, so
// the two surfaces can never drift.
//   <CanvasRenderer spec={spec} />
export const CanvasRenderer = createRenderer(canvasCatalog, {
  Page: ({ element, children }) => (
    <PageBody props={element.props} ctx={PLAIN_CTX}>
      {children}
    </PageBody>
  ),
  Grid: ({ element, children }) => (
    <GridBody props={element.props} ctx={PLAIN_CTX}>
      {children}
    </GridBody>
  ),
  Card: ({ element, children }) => (
    <CardBody props={element.props} ctx={PLAIN_CTX}>
      {children}
    </CardBody>
  ),
  Heading: ({ element }) => (
    <HeadingBody props={element.props} ctx={PLAIN_CTX} />
  ),
  Text: ({ element }) => <TextBody props={element.props} ctx={PLAIN_CTX} />,
  Stat: ({ element }) => <StatBody props={element.props} ctx={PLAIN_CTX} />,
  Table: ({ element }) => <TableBody props={element.props} ctx={PLAIN_CTX} />,
  BarList: ({ element }) => (
    <BarListBody props={element.props} ctx={PLAIN_CTX} />
  ),
  Badge: ({ element }) => <BadgeBody props={element.props} ctx={PLAIN_CTX} />,
  Divider: () => <DividerBody />,
});
