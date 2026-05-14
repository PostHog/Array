import { cloneElement, type ReactElement } from "react";
import { Text, type TextProps } from "react-native";

// Apply Open Runde as the default fontFamily for every <Text>, including those
// imported directly from react-native. User-provided styles (e.g. font-mono via
// NativeWind className) appear later in the style array and override the default.
type PatchableText = {
  render: (...args: unknown[]) => ReactElement<TextProps>;
  __posthogPatched?: boolean;
};
const TextRef = Text as unknown as PatchableText;

if (!TextRef.__posthogPatched) {
  const baseRender = TextRef.render;
  TextRef.render = function patchedRender(...args) {
    const element = baseRender.apply(this, args);
    return cloneElement(element, {
      style: [{ fontFamily: "Open Runde" }, element.props.style],
    });
  };
  TextRef.__posthogPatched = true;
}
