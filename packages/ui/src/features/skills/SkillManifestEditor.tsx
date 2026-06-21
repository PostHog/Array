import { Sparkle } from "@phosphor-icons/react";
import { SKILL_GENERATOR_SERVICE } from "@posthog/core/skills/identifiers";
import type { SkillGeneratorService } from "@posthog/core/skills/skillGeneratorService";
import { useService } from "@posthog/di/react";
import type { SkillInfo } from "@posthog/shared";
import { toast } from "@posthog/ui/primitives/toast";
import {
  Box,
  Button,
  Flex,
  Spinner,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useRef, useState } from "react";
import { SkillCodeEditor } from "./SkillCodeEditor";
import { skillErrorDescription } from "./skillErrors";
import { useSaveSkillManifest } from "./useSkillMutations";

interface SkillManifestEditorProps {
  skill: SkillInfo;
  initialBody: string;
  onCancel: () => void;
  onSaved: () => void;
}

/**
 * Edit mode for SKILL.md: a small form for the frontmatter (users never
 * hand-edit YAML) plus a markdown editor for the body.
 */
export function SkillManifestEditor({
  skill,
  initialBody,
  onCancel,
  onSaved,
}: SkillManifestEditorProps) {
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  // Captured at mount: background refetches must not reset in-flight edits.
  const [mountedBody] = useState(initialBody);
  const bodyRef = useRef(mountedBody);
  const saveManifest = useSaveSkillManifest();

  const generator = useService<SkillGeneratorService>(SKILL_GENERATOR_SERVICE);
  const [isGenerating, setIsGenerating] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [editorContent, setEditorContent] = useState(mountedBody);
  const abortRef = useRef<AbortController | null>(null);

  const handleGenerate = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsGenerating(true);
    try {
      const { body: generated, description: generatedDesc } =
        await generator.generate(name.trim(), description.trim(), ctrl.signal);
      if (generatedDesc && !description.trim()) {
        setDescription(generatedDesc);
      }
      bodyRef.current = generated;
      setEditorContent(generated);
      setEditorKey((k) => k + 1);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      toast.error("Failed to generate skill content", {
        description: skillErrorDescription(err),
      });
    } finally {
      if (!ctrl.signal.aborted) setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    try {
      await saveManifest.mutateAsync({
        skillPath: skill.path,
        name,
        description,
        body: bodyRef.current,
      });
      onSaved();
    } catch (error) {
      toast.error("Failed to save skill", {
        description: skillErrorDescription(error),
      });
    }
  };

  return (
    <Flex direction="column" height="100%">
      <Flex direction="column" gap="2" p="3" className="shrink-0">
        <Box>
          <Text as="label" className="mb-1 block text-[12px] text-gray-10">
            Name
          </Text>
          <TextField.Root
            size="1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="skill-name"
          />
        </Box>
        <Box>
          <Flex align="center" justify="between" mb="1">
            <Text as="label" className="text-[12px] text-gray-10">
              Description
            </Text>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={isGenerating || !name.trim()}
              className="flex items-center gap-1 rounded text-[11px] text-accent-11 hover:text-accent-12 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isGenerating ? (
                <Spinner size="1" />
              ) : (
                <Sparkle size={11} weight="fill" />
              )}
              {isGenerating ? "Generating…" : "Generate with AI"}
            </button>
          </Flex>
          <TextArea
            size="1"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="When should an agent use this skill?"
          />
        </Box>
      </Flex>

      <Box className="min-h-0 flex-1 border-t border-t-(--gray-5)">
        <SkillCodeEditor
          key={editorKey}
          initialContent={editorContent}
          filePath={`${skill.path}/SKILL.md`}
          onDocChanged={(doc) => {
            bodyRef.current = doc;
          }}
        />
      </Box>

      <Flex
        justify="end"
        gap="2"
        p="2"
        className="shrink-0 border-t border-t-(--gray-5)"
      >
        <Button size="1" variant="soft" color="gray" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="1"
          variant="solid"
          onClick={handleSave}
          disabled={saveManifest.isPending || !name.trim()}
        >
          Save
        </Button>
      </Flex>
    </Flex>
  );
}
