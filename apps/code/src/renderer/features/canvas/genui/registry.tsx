import { canvasCatalog } from "@features/canvas/genui/catalog";
import { createRenderer } from "@json-render/react";
import { Badge, Box, Flex, Grid, Heading, Table, Text } from "@radix-ui/themes";

// Maps catalog component names to concrete Radix UI implementations. The
// returned component renders an agent-generated Spec:
//   <CanvasRenderer spec={spec} />
// Each renderer receives `element` whose `props` are typed from the catalog.
export const CanvasRenderer = createRenderer(canvasCatalog, {
  Page: ({ element, children }) => (
    <Flex direction="column" gap="4" p="5">
      {element.props.title && (
        <Heading size="6" className="text-gray-12">
          {element.props.title}
        </Heading>
      )}
      {children}
    </Flex>
  ),
  Grid: ({ element, children }) => (
    <Grid columns={String(element.props.columns ?? 2)} gap="3" width="auto">
      {children}
    </Grid>
  ),
  Card: ({ element, children }) => (
    <Box className="rounded-lg border border-gray-6 bg-gray-1 p-4">
      {element.props.title && (
        <Text size="2" weight="bold" className="mb-2 block text-gray-12">
          {element.props.title}
        </Text>
      )}
      {children}
    </Box>
  ),
  Heading: ({ element }) => (
    <Heading
      size={
        element.props.level === 1 ? "6" : element.props.level === 3 ? "3" : "4"
      }
      className="text-gray-12"
    >
      {element.props.text}
    </Heading>
  ),
  Text: ({ element }) => (
    <Text
      size="2"
      as="p"
      className={element.props.muted ? "text-gray-10" : "text-gray-12"}
    >
      {element.props.text}
    </Text>
  ),
  Stat: ({ element }) => (
    <Flex direction="column" gap="1">
      <Text size="1" className="text-gray-10">
        {element.props.label}
      </Text>
      <Text size="7" weight="bold" className="text-gray-12">
        {String(element.props.value)}
      </Text>
      {element.props.delta && (
        <Text size="1" className="text-gray-10">
          {element.props.delta}
        </Text>
      )}
    </Flex>
  ),
  Table: ({ element }) => (
    <Table.Root size="1" variant="surface">
      <Table.Header>
        <Table.Row>
          {element.props.columns.map((col) => (
            <Table.ColumnHeaderCell key={col}>{col}</Table.ColumnHeaderCell>
          ))}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {element.props.rows.map((row, ri) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: spec rows have no id
          <Table.Row key={ri}>
            {row.map((cell, ci) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: spec cells have no id
              <Table.Cell key={ci}>{String(cell)}</Table.Cell>
            ))}
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  ),
  BarList: ({ element }) => {
    const items = element.props.items;
    const max = Math.max(1, ...items.map((i) => i.value));
    return (
      <Flex direction="column" gap="2">
        {items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: spec items have no id
          <Flex key={i} align="center" gap="2">
            <Box className="relative h-6 flex-1 overflow-hidden rounded bg-gray-3">
              <Box
                className="absolute inset-y-0 left-0 rounded bg-accent-5"
                style={{ width: `${(item.value / max) * 100}%` }}
              />
              <Text
                size="1"
                className="absolute inset-y-0 left-2 flex items-center text-gray-12"
              >
                {item.label}
              </Text>
            </Box>
            <Text
              size="1"
              weight="bold"
              className="w-12 text-right text-gray-11"
            >
              {item.value}
            </Text>
          </Flex>
        ))}
      </Flex>
    );
  },
  Badge: ({ element }) => (
    <Badge color={element.props.color ?? "gray"}>{element.props.text}</Badge>
  ),
  Divider: () => <Box className="my-2 h-px bg-gray-6" />,
});
