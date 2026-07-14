import type {
  SourceConfig,
  SourceFieldConfig,
  SourceFieldInputConfig,
  SourceFieldOauthConfig,
} from "@posthog/api-client/posthog-client";
import { useHostTRPC } from "@posthog/host-router/react";
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
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type FieldValue = string | number | boolean;
type FieldValues = Record<string, FieldValue>;

/** Poll cadence/ceiling for discovering the integration created by an OAuth grant. */
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

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
 * A field type the generic renderer cannot handle inline (SSH tunnels, file
 * uploads). Sources requiring these still need a bespoke form.
 */
function isUnsupportedField(field: SourceFieldConfig): boolean {
  return field.type === "ssh-tunnel" || field.type === "file-upload";
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
      } else if (field.type === "oauth") {
        if (field.required && !values[field.name]) {
          missing.push(field.name);
        }
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
      } else if (field.type === "oauth") {
        const value = values[field.name];
        if (value !== undefined && value !== "") out[field.name] = value;
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

  const setValue = useCallback((name: string, value: FieldValue) => {
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
              providerName={title.replace(/^Connect\s+/i, "")}
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
  providerName,
}: {
  field: SourceFieldConfig;
  values: FieldValues;
  setValue: (name: string, value: FieldValue) => void;
  providerName: string;
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
              providerName={providerName}
            />
          ))}
      </Flex>
    );
  }

  if (field.type === "oauth") {
    return (
      <OAuthSourceField
        field={field}
        value={values[field.name]}
        setValue={setValue}
        providerName={providerName}
      />
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
            providerName={providerName}
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

/**
 * Renders an `oauth` config field: a connect button that launches the provider's
 * OAuth flow, polls for the resulting integration, and writes its id into the
 * form. Mirrors the previous bespoke Linear setup. Only providers with a wired
 * flow starter (currently `linear`) can be connected here; others surface a
 * message.
 */
function OAuthSourceField({
  field,
  value,
  setValue,
  providerName,
}: {
  field: SourceFieldOauthConfig;
  value: FieldValue | undefined;
  setValue: (name: string, value: FieldValue) => void;
  providerName: string;
}) {
  const region = useAuthStateValue((state) => state.cloudRegion);
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  const client = useAuthenticatedClient();
  const trpc = useHostTRPC();
  const startLinearFlow = useMutation(
    trpc.linearIntegration.startFlow.mutationOptions(),
  );
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    if (pollTimeout.current) {
      clearTimeout(pollTimeout.current);
      pollTimeout.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const connected = value !== undefined && value !== "";

  const startFlow = useCallback(async () => {
    if (field.kind === "linear") {
      if (!region || !projectId) throw new Error("Missing project context");
      await startLinearFlow.mutateAsync({ region, projectId });
      return;
    }
    throw new Error(`Connecting ${providerName} isn't supported here yet.`);
  }, [field.kind, region, projectId, startLinearFlow, providerName]);

  const handleConnect = useCallback(async () => {
    if (!projectId || !client) return;
    setConnecting(true);
    setError(null);
    try {
      await startFlow();
      pollTimer.current = setInterval(async () => {
        try {
          const integrations =
            await client.getIntegrationsForProject(projectId);
          const match = integrations.find(
            (i: { kind: string }) => i.kind === field.kind,
          ) as { id: number | string } | undefined;
          if (match) {
            stopPolling();
            setConnecting(false);
            setValue(field.name, match.id);
            toast.success(`${providerName} connected`);
          }
        } catch {
          // Ignore individual poll failures; the timeout below bounds the wait.
        }
      }, POLL_INTERVAL_MS);
      pollTimeout.current = setTimeout(() => {
        stopPolling();
        setConnecting(false);
        setError("Connection timed out. Please try again.");
      }, POLL_TIMEOUT_MS);
    } catch (err) {
      setConnecting(false);
      setError(
        err instanceof Error
          ? err.message
          : `Failed to connect ${providerName}`,
      );
    }
  }, [
    projectId,
    client,
    startFlow,
    field.kind,
    field.name,
    setValue,
    providerName,
    stopPolling,
  ]);

  return (
    <Flex direction="column" gap="2">
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={handleConnect}
        disabled={connecting || connected}
      >
        {connected
          ? `${providerName} connected`
          : connecting
            ? "Waiting for authorization..."
            : `Log into ${providerName} to continue`}
      </Button>
      {error && <Text className="text-(--red-11) text-sm">{error}</Text>}
    </Flex>
  );
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
