import {
  CodeIcon,
  FontBoldIcon,
  FontItalicIcon,
  Link1Icon,
  ListBulletIcon,
  QuoteIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from "@radix-ui/react-icons";
import { Flex, IconButton, Select, Separator } from "@radix-ui/themes";
import type { Editor } from "@tiptap/react";

interface FormattingToolbarProps {
  editor: Editor;
}

export function FormattingToolbar({ editor }: FormattingToolbarProps) {
  const toggleBold = () => editor.chain().focus().toggleBold().run();
  const toggleItalic = () => editor.chain().focus().toggleItalic().run();
  const toggleUnderline = () => editor.chain().focus().toggleUnderline().run();
  const toggleStrike = () => editor.chain().focus().toggleStrike().run();
  const toggleCode = () => editor.chain().focus().toggleCode().run();
  const toggleCodeBlock = () => editor.chain().focus().toggleCodeBlock().run();
  const toggleBlockquote = () =>
    editor.chain().focus().toggleBlockquote().run();
  const toggleBulletList = () =>
    editor.chain().focus().toggleBulletList().run();
  const toggleOrderedList = () =>
    editor.chain().focus().toggleOrderedList().run();

  const setLink = () => {
    const url = window.prompt("Enter URL:");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  const setHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    editor.chain().focus().toggleHeading({ level }).run();
  };

  const getCurrentHeading = () => {
    for (let i = 1; i <= 6; i++) {
      if (editor.isActive("heading", { level: i })) {
        return i.toString();
      }
    }
    if (editor.isActive("paragraph")) {
      return "paragraph";
    }
    return "paragraph";
  };

  return (
    <Flex
      gap="2"
      align="center"
      py="2"
      px="2"
      style={{
        borderBottom: "1px solid var(--gray-a6)",
        backgroundColor: "var(--gray-a2)",
        borderTopLeftRadius: "var(--radius-2)",
        borderTopRightRadius: "var(--radius-2)",
      }}
    >
      {/* Heading Selector */}
      <Select.Root
        value={getCurrentHeading()}
        onValueChange={(value) => {
          if (value === "paragraph") {
            editor.chain().focus().setParagraph().run();
          } else {
            setHeading(parseInt(value, 10) as 1 | 2 | 3 | 4 | 5 | 6);
          }
        }}
        size="1"
      >
        <Select.Trigger style={{ minWidth: "80px" }} />
        <Select.Content>
          <Select.Item value="paragraph">Paragraph</Select.Item>
          <Select.Item value="1">Heading 1</Select.Item>
          <Select.Item value="2">Heading 2</Select.Item>
          <Select.Item value="3">Heading 3</Select.Item>
          <Select.Item value="4">Heading 4</Select.Item>
          <Select.Item value="5">Heading 5</Select.Item>
          <Select.Item value="6">Heading 6</Select.Item>
        </Select.Content>
      </Select.Root>

      <Separator orientation="vertical" />

      {/* Text Formatting */}
      <IconButton
        size="1"
        variant={editor.isActive("bold") ? "solid" : "ghost"}
        onClick={toggleBold}
        title="Bold (Ctrl+B)"
      >
        <FontBoldIcon />
      </IconButton>

      <IconButton
        size="1"
        variant={editor.isActive("italic") ? "solid" : "ghost"}
        onClick={toggleItalic}
        title="Italic (Ctrl+I)"
      >
        <FontItalicIcon />
      </IconButton>

      <IconButton
        size="1"
        variant={editor.isActive("underline") ? "solid" : "ghost"}
        onClick={toggleUnderline}
        title="Underline (Ctrl+U)"
      >
        <UnderlineIcon />
      </IconButton>

      <IconButton
        size="1"
        variant={editor.isActive("strike") ? "solid" : "ghost"}
        onClick={toggleStrike}
        title="Strikethrough (Ctrl+Shift+X)"
      >
        <StrikethroughIcon />
      </IconButton>

      <Separator orientation="vertical" />

      {/* Code */}
      <IconButton
        size="1"
        variant={editor.isActive("code") ? "solid" : "ghost"}
        onClick={toggleCode}
        title="Inline Code (Ctrl+E)"
      >
        <CodeIcon />
      </IconButton>

      <IconButton
        size="1"
        variant={editor.isActive("codeBlock") ? "solid" : "ghost"}
        onClick={toggleCodeBlock}
        title="Code Block (Ctrl+Shift+C)"
      >
        <CodeIcon />
      </IconButton>

      <Separator orientation="vertical" />

      {/* Lists and Blocks */}
      <IconButton
        size="1"
        variant={editor.isActive("bulletList") ? "solid" : "ghost"}
        onClick={toggleBulletList}
        title="Bullet List (Ctrl+Shift+8)"
      >
        <ListBulletIcon />
      </IconButton>

      <IconButton
        size="1"
        variant={editor.isActive("orderedList") ? "solid" : "ghost"}
        onClick={toggleOrderedList}
        title="Numbered List (Ctrl+Shift+7)"
      >
        <span style={{ fontSize: "11px", fontWeight: "bold" }}>1.</span>
      </IconButton>

      <IconButton
        size="1"
        variant={editor.isActive("blockquote") ? "solid" : "ghost"}
        onClick={toggleBlockquote}
        title="Blockquote (Ctrl+Shift+B)"
      >
        <QuoteIcon />
      </IconButton>

      <Separator orientation="vertical" />

      {/* Links */}
      <IconButton
        size="1"
        variant={editor.isActive("link") ? "solid" : "ghost"}
        onClick={setLink}
        title="Link (Ctrl+K)"
      >
        <Link1Icon />
      </IconButton>
    </Flex>
  );
}
