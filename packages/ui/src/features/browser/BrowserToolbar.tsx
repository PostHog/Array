import { useHostTRPCClient } from "@posthog/host-router/react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import { Flex, IconButton, TextField } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBrowserViewState } from "./browserStore";

interface BrowserToolbarProps {
  browserId: string;
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "about:blank";
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("about:")) {
    return trimmed;
  }
  if (trimmed.includes(".") && !trimmed.includes(" ")) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function BrowserToolbar({ browserId }: BrowserToolbarProps) {
  const client = useHostTRPCClient();
  const {
    url,
    title: _title,
    canGoBack,
    canGoForward,
    isLoading,
  } = useBrowserViewState(browserId);

  const [inputValue, setInputValue] = useState(url);
  const inputRef = useRef<HTMLInputElement>(null);
  const isEditingRef = useRef(false);
  const didNavigateRef = useRef(false);

  useEffect(() => {
    if (!isEditingRef.current) {
      setInputValue(url);
    }
  }, [url]);

  const handleNavigate = useCallback(() => {
    const target = normalizeUrl(inputValue);
    setInputValue(target);
    isEditingRef.current = false;
    didNavigateRef.current = true;
    client.browser.navigate.mutate({ browserId, url: target });
    inputRef.current?.blur();
  }, [browserId, client, inputValue]);

  return (
    <Flex
      align="center"
      gap="1"
      px="2"
      style={{
        height: "36px",
        flexShrink: 0,
        borderBottom: "1px solid var(--gray-4)",
      }}
    >
      <IconButton
        variant="ghost"
        size="1"
        disabled={!canGoBack}
        onClick={() => client.browser.goBack.mutate({ browserId })}
      >
        <ArrowLeftIcon />
      </IconButton>

      <IconButton
        variant="ghost"
        size="1"
        disabled={!canGoForward}
        onClick={() => client.browser.goForward.mutate({ browserId })}
      >
        <ArrowRightIcon />
      </IconButton>

      <IconButton
        variant="ghost"
        size="1"
        onClick={() =>
          isLoading
            ? client.browser.reload.mutate({ browserId })
            : client.browser.reload.mutate({ browserId })
        }
      >
        <ReloadIcon />
      </IconButton>

      <TextField.Root
        ref={inputRef}
        value={inputValue}
        size="1"
        style={{ flex: 1 }}
        onFocus={(e) => {
          isEditingRef.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          isEditingRef.current = false;
          if (!didNavigateRef.current) {
            setInputValue(url);
          }
          didNavigateRef.current = false;
        }}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleNavigate();
          if (e.key === "Escape") {
            setInputValue(url);
            inputRef.current?.blur();
          }
        }}
      />
    </Flex>
  );
}
