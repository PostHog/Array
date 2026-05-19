import { useSandboxEnvironments } from "@features/settings/hooks/useSandboxEnvironments";
import { useSettingsDialogStore } from "@features/settings/stores/settingsDialogStore";
import { ArrowLeft, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Badge,
  Button,
  Checkbox,
  Flex,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import type {
  NetworkAccessLevel,
  SandboxEnvironment,
  SandboxEnvironmentInput,
} from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const NETWORK_ACCESS_OPTIONS: {
  value: NetworkAccessLevel;
  label: string;
  description: string;
}[] = [
  {
    value: "trusted",
    label: "Trusted",
    description: "Downloads packages from verified sources",
  },
  {
    value: "full",
    label: "Full",
    description: "Unrestricted internet access",
  },
  {
    value: "custom",
    label: "Custom",
    description: "Create a list of allowed domains",
  },
];

const DOMAIN_RE =
  /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isValidDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain);
}

function validateDomains(text: string): {
  domains: string[];
  errors: string[];
} {
  const domains: string[] = [];
  const errors: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isValidDomain(trimmed)) {
      domains.push(trimmed);
    } else {
      errors.push(`Invalid domain: ${trimmed}`);
    }
  }
  return { domains, errors };
}

function validateEnvVars(text: string): {
  vars: Record<string, string>;
  errors: string[];
} {
  const vars: Record<string, string> = {};
  const errors: string[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) {
      errors.push(`Line ${i + 1}: missing '=' separator`);
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    if (!ENV_KEY_RE.test(key)) {
      errors.push(`Line ${i + 1}: invalid key "${key}"`);
      continue;
    }
    vars[key] = trimmed.slice(eqIdx + 1).trim();
  }
  return { vars, errors };
}

interface FormState {
  name: string;
  network_access_level: NetworkAccessLevel;
  allowed_domains_text: string;
  include_default_domains: boolean;
  environment_variables_text: string;
  private: boolean;
}

function emptyForm(): FormState {
  return {
    name: "",
    network_access_level: "full",
    allowed_domains_text: "",
    include_default_domains: true,
    environment_variables_text: "",
    private: true,
  };
}

function formFromEnv(env: SandboxEnvironment): FormState {
  return {
    name: env.name,
    network_access_level: env.network_access_level,
    allowed_domains_text: env.allowed_domains.join("\n"),
    include_default_domains: env.include_default_domains,
    environment_variables_text: "",
    private: env.private,
  };
}

function NetworkAccessSelect({
  value,
  onChange,
}: {
  value: NetworkAccessLevel;
  onChange: (v: NetworkAccessLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const current =
    NETWORK_ACCESS_OPTIONS.find((o) => o.value === value) ??
    NETWORK_ACCESS_OPTIONS[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-2 border border-gray-6 bg-transparent px-3 py-2 text-left font-mono text-[13px] text-gray-12 transition-colors hover:border-gray-8"
      >
        <Flex direction="column" gap="0">
          <Text className="text-sm">{current.label}</Text>
          <Text color="gray" className="text-[13px]">
            {current.description}
          </Text>
        </Flex>
        <ChevronDownIcon
          style={{
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform 150ms",
          }}
          className="shrink-0"
        />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-2 border border-gray-6 bg-(--color-panel-solid) shadow-lg">
          {NETWORK_ACCESS_OPTIONS.map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className="flex w-full cursor-pointer flex-col gap-0 border-0 bg-transparent px-3 py-2 text-left transition-colors hover:bg-gray-3 data-[active]:bg-accent-4"
              data-active={opt.value === value || undefined}
            >
              <Text
                className={`text-sm ${opt.value === value ? "font-medium" : ""}`}
              >
                {opt.label}
              </Text>
              <Text color="gray" className="text-[13px]">
                {opt.description}
              </Text>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CloudEnvironmentsSettings() {
  const {
    environments,
    isLoading,
    createMutation,
    updateMutation,
    deleteMutation,
  } = useSandboxEnvironments();
  const consumeInitialAction = useSettingsDialogStore(
    (s) => s.consumeInitialAction,
  );
  const setFormMode = useSettingsDialogStore((s) => s.setFormMode);
  const [editingEnv, setEditingEnv] = useState<SandboxEnvironment | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  useEffect(() => {
    const action = consumeInitialAction();
    if (action === "create") {
      setForm(emptyForm());
      setEditingEnv(null);
      setIsCreating(true);
    }
  }, [consumeInitialAction]);

  const isFormOpen = isCreating || editingEnv !== null;

  useEffect(() => {
    setFormMode(isFormOpen);
    return () => setFormMode(false);
  }, [isFormOpen, setFormMode]);

  const domainValidation = useMemo(() => {
    if (form.network_access_level !== "custom")
      return { domains: [], errors: [] };
    return validateDomains(form.allowed_domains_text);
  }, [form.network_access_level, form.allowed_domains_text]);

  const envVarValidation = useMemo(
    () => validateEnvVars(form.environment_variables_text),
    [form.environment_variables_text],
  );

  const hasValidationErrors =
    domainValidation.errors.length > 0 || envVarValidation.errors.length > 0;

  const openCreate = useCallback(() => {
    setForm(emptyForm());
    setEditingEnv(null);
    setIsCreating(true);
  }, []);

  const openEdit = useCallback((env: SandboxEnvironment) => {
    setForm(formFromEnv(env));
    setEditingEnv(env);
    setIsCreating(false);
  }, []);

  const closeForm = useCallback(() => {
    setEditingEnv(null);
    setIsCreating(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (hasValidationErrors) {
      toast.error("Fix validation errors before saving");
      return;
    }

    const payload: SandboxEnvironmentInput = {
      name: form.name,
      network_access_level: form.network_access_level,
      allowed_domains:
        form.network_access_level === "custom" ? domainValidation.domains : [],
      include_default_domains:
        form.network_access_level === "custom"
          ? form.include_default_domains
          : false,
      private: form.private,
      repositories: [],
      ...(form.environment_variables_text.trim()
        ? { environment_variables: envVarValidation.vars }
        : {}),
    };

    if (editingEnv) {
      await updateMutation.mutateAsync({ id: editingEnv.id, ...payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    closeForm();
  }, [
    form,
    editingEnv,
    hasValidationErrors,
    domainValidation,
    envVarValidation,
    createMutation,
    updateMutation,
    closeForm,
  ]);

  const handleDelete = useCallback(async () => {
    if (!editingEnv) return;
    await deleteMutation.mutateAsync(editingEnv.id);
    closeForm();
  }, [editingEnv, deleteMutation, closeForm]);

  if (isFormOpen) {
    return (
      <Flex direction="column" gap="4">
        <button
          type="button"
          onClick={closeForm}
          className="flex w-fit cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12px] text-gray-11 hover:text-gray-12"
        >
          <ArrowLeft size={10} />
          <span>Back to environments</span>
        </button>

        <Text className="font-medium text-[13px]">
          {editingEnv
            ? `Editing cloud environment ${editingEnv.name}`
            : "Creating cloud environment"}
        </Text>
        {editingEnv && (
          <Text color="gray" className="text-[12px]">
            Changes take effect on the next session that uses this environment;
            running sessions are not affected.
          </Text>
        )}

        <Flex direction="column" gap="1">
          <Text className="font-medium text-sm">Name</Text>
          <Text color="gray" className="text-[13px]">
            Shown in the workspace picker. Pick a name that describes the access
            profile, e.g. "Internal APIs" or "Read-only".
          </Text>
          <TextField.Root
            size="2"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Dev 1"
          />
        </Flex>

        <Flex direction="column" gap="1">
          <Text className="font-medium text-sm">Network access</Text>
          <Text color="gray" className="text-[13px]">
            Controls which hosts the sandbox may reach.{" "}
            <Text color="gray" className="font-medium text-[13px]">
              Full
            </Text>{" "}
            allows any outbound traffic.{" "}
            <Text color="gray" className="font-medium text-[13px]">
              Trusted sources only
            </Text>{" "}
            restricts traffic to a curated list of common package registries and
            source hosts.{" "}
            <Text color="gray" className="font-medium text-[13px]">
              Custom
            </Text>{" "}
            lets you define an explicit allowlist below.
          </Text>
          <NetworkAccessSelect
            value={form.network_access_level}
            onChange={(v) =>
              setForm((f) => ({ ...f, network_access_level: v }))
            }
          />
        </Flex>

        {form.network_access_level === "custom" && (
          <>
            <Flex direction="column" gap="1">
              <Text className="font-medium text-sm">Allowed domains</Text>
              <Text color="gray" className="text-[13px]">
                One domain per line (not URLs — no scheme or path). Use{" "}
                <Text color="gray" className="font-medium text-[13px]">
                  *
                </Text>{" "}
                as a wildcard, e.g.{" "}
                <Text color="gray" className="font-medium text-[13px]">
                  *.example.com
                </Text>{" "}
                to cover all subdomains. Requests to any other host are blocked.
              </Text>
              <TextArea
                size="2"
                rows={4}
                value={form.allowed_domains_text}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    allowed_domains_text: e.target.value,
                  }))
                }
                placeholder={"github.com\n*.example.com"}
                color={domainValidation.errors.length > 0 ? "red" : undefined}
                className="font-[var(--code-font-family)] [&_textarea]:text-xs"
              />
              {domainValidation.errors.length > 0 && (
                <Flex direction="column" gap="0">
                  {domainValidation.errors.map((err) => (
                    <Text key={err} color="red" className="text-[13px]">
                      {err}
                    </Text>
                  ))}
                </Flex>
              )}
            </Flex>

            <Flex align="center" gap="2">
              <Checkbox
                size="1"
                checked={form.include_default_domains}
                onCheckedChange={(checked) =>
                  setForm((f) => ({
                    ...f,
                    include_default_domains: checked === true,
                  }))
                }
              />
              <Text color="gray" className="text-[13px]">
                Also include the built-in list of common package managers and
                source hosts — recommended unless you deliberately want to block
                them.
              </Text>
            </Flex>
          </>
        )}

        <Flex direction="column" gap="1">
          <Text className="font-medium text-sm">Environment variables</Text>
          <Text color="gray" className="text-[13px]">
            Injected into the sandbox shell before the agent runs — useful for
            API keys or service tokens the agent needs. Standard{" "}
            <Text color="gray" className="font-medium text-[13px]">
              .env
            </Text>{" "}
            format: one{" "}
            <Text color="gray" className="font-medium text-[13px]">
              KEY=value
            </Text>{" "}
            per line. Existing values aren't shown back once saved; leave the
            field blank to keep them unchanged, or enter new values to replace
            them.
          </Text>
          <TextArea
            size="2"
            rows={4}
            value={form.environment_variables_text}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                environment_variables_text: e.target.value,
              }))
            }
            placeholder={
              editingEnv?.has_environment_variables
                ? "Environment variables are set. Enter new values to replace them."
                : "KEY=value"
            }
            color={envVarValidation.errors.length > 0 ? "red" : undefined}
            className="font-[var(--code-font-family)] [&_textarea]:text-xs"
          />
          {envVarValidation.errors.length > 0 && (
            <Flex direction="column" gap="0">
              {envVarValidation.errors.map((err) => (
                <Text key={err} color="red" className="text-[13px]">
                  {err}
                </Text>
              ))}
            </Flex>
          )}
        </Flex>

        <Flex justify="between" pt="2">
          {editingEnv ? (
            <Button
              color="red"
              variant="ghost"
              size="1"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              <Trash size={14} />
              Archive
            </Button>
          ) : (
            <div />
          )}
          <Flex gap="2">
            <Button color="gray" variant="outline" size="2" onClick={closeForm}>
              Cancel
            </Button>
            <Button
              size="2"
              onClick={handleSave}
              disabled={
                !form.name.trim() ||
                hasValidationErrors ||
                createMutation.isPending ||
                updateMutation.isPending
              }
            >
              {editingEnv ? "Save changes" : "Create environment"}
            </Button>
          </Flex>
        </Flex>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="4">
      <Text color="gray" className="text-[13px]">
        A cloud environment is a sandbox profile for tasks that run remotely. It
        controls which outbound hosts the sandbox can reach and which
        environment variables — like API keys — are injected before the agent
        starts. Account-wide, so the same profile is available across all your
        projects. The built-in{" "}
        <Text color="gray" className="font-medium text-[13px]">
          Default
        </Text>{" "}
        uses full network access; create your own to lock things down or share
        secrets with the agent. Pick one in the Cloud section of the workspace
        picker when starting a task.
      </Text>
      <Flex justify="between" align="center">
        <Text className="font-medium text-[13px]">Environments</Text>
        <Button size="1" variant="outline" onClick={openCreate}>
          <Plus size={12} />
          New environment
        </Button>
      </Flex>

      {isLoading ? (
        <Text color="gray" className="text-[13px]">
          Loading environments...
        </Text>
      ) : environments.length === 0 ? (
        <Text color="gray" className="text-[13px]">
          No cloud environments configured yet. Create one to control network
          access for your cloud sessions.
        </Text>
      ) : (
        <Flex direction="column">
          {environments.map((env, i) => (
            <Flex
              key={env.id}
              align="center"
              justify="between"
              py="3"
              px="1"
              gap="3"
              style={{
                borderBottom:
                  i < environments.length - 1
                    ? "1px solid var(--gray-5)"
                    : undefined,
              }}
            >
              <Flex direction="column" gap="1" className="min-w-0 flex-1">
                <Text className="font-medium text-sm">{env.name}</Text>
                <Flex align="center" gap="2">
                  <Badge
                    size="1"
                    color={
                      env.network_access_level === "full"
                        ? "green"
                        : env.network_access_level === "trusted"
                          ? "blue"
                          : "orange"
                    }
                    variant="soft"
                  >
                    {env.network_access_level}
                  </Badge>
                  {env.network_access_level === "custom" &&
                    env.allowed_domains.length > 0 && (
                      <Text color="gray" className="text-[13px]">
                        {env.allowed_domains.length} domain
                        {env.allowed_domains.length !== 1 ? "s" : ""}
                      </Text>
                    )}
                </Flex>
              </Flex>
              <Button
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => openEdit(env)}
                className="shrink-0"
              >
                <PencilSimple size={14} />
              </Button>
            </Flex>
          ))}
        </Flex>
      )}
    </Flex>
  );
}
