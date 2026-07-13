import type {
  SourceConfig,
  SourceFieldConfig,
  SourceFieldInputConfig,
} from "@posthog/api-client/posthog-client";
import { Button } from "@posthog/quill";
import { useAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { useSourceConfig } from "@posthog/ui/features/inbox/hooks/useSourceConfig";
import { toast } from "@posthog/ui/primitives/toast";
import {
  Box,
  Flex,
  Select,
  Switch,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useCallback, useMemo, useState } from "react";

interface SchemaPayload {
  name: string;
  should_sync: boolean;
  sync_type: string;
}

interface DynamicSourceSetupProps {
  /** Capitalized DWH source type string, e.g. `"Jira"`. */
  sourceType: string;
  title: string;
  /** The warehouse tables to sync for this source (forced on at create time). */
  schemas: SchemaPayload[];
  onComplete: () => void;
  onCancel: () => void;
}

type FieldValues = Record<string, string | boolean>;

const INPUT_TYPES = new Set([
  "text",
  "email",
  "search",
  "url",
  "password",
  "time",
  "number",
  "textarea",
]);

/** Whether a field is a plain text-like input the generic renderer handles. */
function isInputField(
  field: SourceFieldConfig,
): field is SourceFieldInputConfig {
  return INPUT_TYPES.has(field.type);
}

/**
 * A field type the generic renderer cannot handle inline (OAuth grants, SSH
 * tunnels, file uploads). Sources requiring these still need a bespoke form.
 */
function isUnsupportedField(field: SourceFieldConfig): boolean {
  return (
    field.type === "oauth" ||
    field.type === "ssh-tunnel" ||
    field.type === "file-upload"
  );
}

/**
 * Walk the currently active fields and collect the names of required inputs and
 * selects that are not yet satisfied, so we can gate the submit button and
 * validate before posting. A select with a `defaultValue` is always satisfied,
 * because the control renders that value pre-selected.
 */
function missingRequiredFields(
  config: SourceConfig,
  values: FieldValues,
): string[] {
  const missing: string[] = [];
  const walk = (fields: SourceFieldConfig[]) => {
    for (const field of fields) {
      if (field.type === "switch-group") {
        if (values[field.name]) walk(field.fields);
      } else if (field.type === "select") {
        const selected =
          (values[field.name] as string) ?? field.defaultValue ?? "";
        if (field.required && selected.trim().length === 0) {
          missing.push(field.name);
        }
        const option = field.options.find((o) => o.value === selected);
        if (option?.fields) walk(option.fields);
      } else if (isInputField(field) && field.required) {
        const value = values[field.name];
        if (typeof value !== "string" || value.trim().length === 0) {
          missing.push(field.name);
        }
      }
    }
  };
  walk(config.fields);
  return missing;
}

/**
 * Build the `createExternalDataSource` payload from the collected field values,
 * mirroring how PostHog Cloud nests switch-group and select fields.
 */
function buildPayload(
  config: SourceConfig,
  values: FieldValues,
): Record<string, unknown> {
  const collect = (fields: SourceFieldConfig[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.type === "switch-group") {
        const enabled = !!values[field.name];
        out[field.name] = { enabled, ...collect(field.fields) };
      } else if (field.type === "select") {
        const selected = (values[field.name] as string) ?? field.defaultValue;
        const option = field.options.find((o) => o.value === selected);
        out[field.name] = {
          selection: selected,
          ...(option?.fields ? collect(option.fields) : {}),
        };
      } else if (isInputField(field)) {
        const value = values[field.name];
        if (typeof value === "string") out[field.name] = value.trim();
      }
    }
    return out;
  };
  return collect(config.fields);
}

export function DynamicSourceSetup({
  sourceType,
  title,
  schemas,
  onComplete,
  onCancel,
}: DynamicSourceSetupProps) {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  const client = useAuthenticatedClient();
  const { data: config, isLoading, error } = useSourceConfig(sourceType);
  const [values, setValues] = useState<FieldValues>({});
  const [submitting, setSubmitting] = useState(false);

  const setValue = useCallback((name: string, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const hasUnsupportedField = useMemo(
    () => (config ? config.fields.some(isUnsupportedField) : false),
    [config],
  );

  const canSubmit = useMemo(() => {
    if (!config || hasUnsupportedField) return false;
    return missingRequiredFields(config, values).length === 0;
  }, [config, values, hasUnsupportedField]);

  const handleSubmit = useCallback(async () => {
    if (!projectId || !client || !config) return;
    setSubmitting(true);
    try {
      await client.createExternalDataSource(projectId, {
        source_type: sourceType,
        payload: { ...buildPayload(config, values), schemas },
      });
      toast.success(`${title} data source created`);
      onComplete();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create data source",
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    projectId,
    client,
    config,
    values,
    schemas,
    sourceType,
    title,
    onComplete,
  ]);

  return (
    <SetupFormContainer title={title}>
      {isLoading ? (
        <Text className="text-gray-11 text-sm">Loading connection form…</Text>
      ) : error || !config ? (
        <Text className="text-(--red-11) text-sm">
          Couldn't load the {title} connection form. Please try again.
        </Text>
      ) : (
        <Flex direction="column" gap="3">
          {config.caption && (
            <Text className="text-[13px] text-gray-11">{config.caption}</Text>
          )}
          {config.fields.map((field) => (
            <SourceField
              key={field.name}
              field={field}
              values={values}
              setValue={setValue}
            />
          ))}
          {hasUnsupportedField && (
            <Text className="text-(--amber-11) text-[13px]">
              This source needs a connection step that isn't supported here yet.
            </Text>
          )}
          <Flex gap="2" justify="end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
            >
              {submitting ? "Creating..." : "Create source"}
            </Button>
          </Flex>
        </Flex>
      )}
    </SetupFormContainer>
  );
}

function SourceField({
  field,
  values,
  setValue,
}: {
  field: SourceFieldConfig;
  values: FieldValues;
  setValue: (name: string, value: string | boolean) => void;
}) {
  if (field.type === "switch-group") {
    const enabled = !!values[field.name];
    return (
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2">
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => setValue(field.name, checked)}
          />
          <Text className="text-gray-12 text-sm">{field.label}</Text>
        </Flex>
        {field.caption && (
          <Text className="text-[13px] text-gray-11">{field.caption}</Text>
        )}
        {enabled &&
          field.fields.map((nested) => (
            <SourceField
              key={nested.name}
              field={nested}
              values={values}
              setValue={setValue}
            />
          ))}
      </Flex>
    );
  }

  if (field.type === "select") {
    const selected = (values[field.name] as string) ?? field.defaultValue ?? "";
    const option = field.options.find((o) => o.value === selected);
    return (
      <Flex direction="column" gap="2">
        <Text className="text-gray-12 text-sm">{field.label}</Text>
        <Select.Root
          value={selected}
          onValueChange={(value) => setValue(field.name, value)}
        >
          <Select.Trigger placeholder={field.label} />
          <Select.Content>
            {field.options.map((o) => (
              <Select.Item key={o.value} value={o.value}>
                {o.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        {option?.fields?.map((nested) => (
          <SourceField
            key={nested.name}
            field={nested}
            values={values}
            setValue={setValue}
          />
        ))}
      </Flex>
    );
  }

  if (isInputField(field)) {
    const isSecret = field.type === "password" || field.secret === true;
    return (
      <Flex direction="column" gap="1">
        <Text className="text-gray-12 text-sm">{field.label}</Text>
        {field.type === "textarea" ? (
          <TextArea
            rows={4}
            placeholder={field.placeholder || field.label}
            value={(values[field.name] as string) ?? ""}
            onChange={(e) => setValue(field.name, e.target.value)}
          />
        ) : (
          <TextField.Root
            type={isSecret ? "password" : field.type}
            placeholder={field.placeholder || field.label}
            value={(values[field.name] as string) ?? ""}
            onChange={(e) => setValue(field.name, e.target.value)}
          />
        )}
        {field.caption && (
          <Text className="text-[13px] text-gray-11">{field.caption}</Text>
        )}
      </Flex>
    );
  }

  return null;
}

function SetupFormContainer({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      p="4"
      className="rounded-(--radius-2) border border-border bg-(--color-panel-solid)"
    >
      <Flex direction="column" gap="3">
        <Flex align="center" justify="between">
          <Text className="font-medium text-gray-12 text-sm">{title}</Text>
        </Flex>
        {children}
      </Flex>
    </Box>
  );
}
