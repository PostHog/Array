# Guidelines

- Use Radix UI/theme for styling. Prefer prestyled components over HTML elements.
- Use `Kbd` for key hints. Fallback to Tailwind CSS when Radix lacks props.
- Use zustand for state management.
- Prefer creating separate, reusable components over large monolithic components.

## Layout Components

- **Box**: Fundamental layout component for spacing, sizing, and responsive display
- **Flex**: Box + flexbox properties for axis-based organization
- **Grid**: Box + grid properties for column/row layouts
- **Section**: Consistent vertical spacing for page sections
- **Container**: Consistent max-width for content

## Space Scale

Spacing props accept "1"-"9" (4px-64px in increments) or any valid CSS value.

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|
| 4px | 8px | 12px | 16px | 24px | 32px | 40px | 48px | 64px |

## Layout Props

All props support responsive object values (e.g., `{{ sm: '6', lg: '9' }}`).

- **Padding**: `p`, `px`, `py`, `pt`, `pr`, `pb`, `pl`
- **Margin**: `m`, `mx`, `my`, `mt`, `mr`, `mb`, `ml` (uses space scale or CSS values)
- **Width**: `width`, `minWidth`, `maxWidth`
- **Height**: `height`, `minHeight`, `maxHeight`
- **Position**: `position`, `inset`, `top`, `right`, `bottom`, `left` (offset values use space scale)
- **Flex child**: `flexBasis`, `flexShrink`, `flexGrow`
- **Grid child**: `gridArea`, `gridColumn`, `gridColumnStart`, `gridColumnEnd`, `gridRow`, `gridRowStart`, `gridRowEnd`