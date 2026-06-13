import { createRenderer } from "@json-render/react";
import {
  BadgeBody,
  BarChartBody,
  BarListBody,
  ButtonBody,
  CardBody,
  CheckboxBody,
  DividerBody,
  type ElementOn,
  GridBody,
  HeadingBody,
  HeatmapBody,
  HeroBody,
  LineChartBody,
  MarkdownBody,
  PageBody,
  PieChartBody,
  PLAIN_CTX,
  ProgressBody,
  RetentionGridBody,
  SectionBody,
  SparklineBody,
  StatBody,
  TableBody,
  TextBody,
  TextInputBody,
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
  LineChart: ({ element }) => (
    <LineChartBody props={element.props} ctx={PLAIN_CTX} />
  ),
  BarChart: ({ element }) => (
    <BarChartBody props={element.props} ctx={PLAIN_CTX} />
  ),
  Sparkline: ({ element }) => (
    <SparklineBody props={element.props} ctx={PLAIN_CTX} />
  ),
  PieChart: ({ element }) => (
    <PieChartBody props={element.props} ctx={PLAIN_CTX} />
  ),
  Progress: ({ element }) => (
    <ProgressBody props={element.props} ctx={PLAIN_CTX} />
  ),
  Heatmap: ({ element }) => (
    <HeatmapBody props={element.props} ctx={PLAIN_CTX} />
  ),
  RetentionGrid: ({ element }) => (
    <RetentionGridBody props={element.props} ctx={PLAIN_CTX} />
  ),
  Badge: ({ element }) => <BadgeBody props={element.props} ctx={PLAIN_CTX} />,
  Section: ({ element, children }) => (
    <SectionBody props={element.props} ctx={PLAIN_CTX}>
      {children}
    </SectionBody>
  ),
  Hero: ({ element }) => <HeroBody props={element.props} ctx={PLAIN_CTX} />,
  Markdown: ({ element }) => (
    <MarkdownBody props={element.props} ctx={PLAIN_CTX} />
  ),
  Button: ({ element }) => (
    <ButtonBody
      props={element.props}
      on={element.on as ElementOn | undefined}
      ctx={PLAIN_CTX}
    />
  ),
  TextInput: ({ element }) => (
    <TextInputBody props={element.props} ctx={PLAIN_CTX} />
  ),
  Checkbox: ({ element }) => (
    <CheckboxBody props={element.props} ctx={PLAIN_CTX} />
  ),
  Divider: () => <DividerBody />,
});
