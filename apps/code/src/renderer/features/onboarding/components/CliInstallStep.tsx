import { Tooltip } from "@components/ui/Tooltip";
import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  ArrowsClockwise,
  Check,
  CheckCircle,
  CircleNotch,
  Copy,
  GitBranch,
  GithubLogo,
  Warning,
} from "@phosphor-icons/react";
import { Box, Button, Flex, IconButton, Text } from "@radix-ui/themes";
import builderHog from "@renderer/assets/images/hedgehogs/builder-hog-03.png";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EXTERNAL_LINKS } from "@utils/links";
import { motion } from "framer-motion";
import { useCallback, useState } from "react";
import { OnboardingHogTip } from "./OnboardingHogTip";
import { StepActions } from "./StepActions";

function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [command]);

  return (
    <Flex
      align="center"
      justify="between"
      gap="2"
      className="rounded-(--radius-2) border border-(--gray-a3) bg-(--gray-2) py-[6px] pr-2 pl-3"
    >
      <Flex align="center" gap="2" className="min-w-0">
        <Text className="select-none font-[var(--code-font-family)] text-(--gray-9) text-sm">
          $
        </Text>
        <Text className="truncate font-[var(--code-font-family)] text-(--gray-12) text-sm">
          {command}
        </Text>
      </Flex>
      <Tooltip content={copied ? "Copied!" : "Copy command"}>
        <IconButton
          size="1"
          variant="ghost"
          color="gray"
          onClick={() => void handleCopy()}
          aria-label="Copy command"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
      </Tooltip>
    </Flex>
  );
}

interface CliInstallStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function CliInstallStep({ onNext, onBack }: CliInstallStepProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [isCheckingGit, setIsCheckingGit] = useState(false);
  const [isCheckingGh, setIsCheckingGh] = useState(false);

  const { data: gitStatus, isLoading: isLoadingGit } = useQuery(
    trpc.git.getGitStatus.queryOptions(undefined, { staleTime: 30_000 }),
  );
  const { data: ghStatus, isLoading: isLoadingGh } = useQuery(
    trpc.git.getGhStatus.queryOptions(undefined, { staleTime: 30_000 }),
  );

  const gitInstalled = gitStatus?.installed ?? false;
  const ghInstalled = ghStatus?.installed ?? false;
  const ghAuthenticated = ghStatus?.authenticated ?? false;
  const allReady = gitInstalled && ghInstalled && ghAuthenticated;

  const handleCheckGit = useCallback(async () => {
    setIsCheckingGit(true);
    await queryClient.invalidateQueries(trpc.git.getGitStatus.queryFilter());
    setIsCheckingGit(false);
  }, [queryClient, trpc]);

  const handleCheckGh = useCallback(async () => {
    setIsCheckingGh(true);
    await queryClient.invalidateQueries(trpc.git.getGhStatus.queryFilter());
    setIsCheckingGh(false);
  }, [queryClient, trpc]);

  return (
    <Flex align="center" height="100%" px="8">
      <Flex
        direction="column"
        align="center"
        className="h-full w-full pt-[24px] pb-[40px]"
      >
        <Flex direction="column" className="min-h-0 flex-1 overflow-y-auto">
          <Flex
            direction="column"
            gap="5"
            className="m-auto w-full max-w-[560px]"
          >
            <Flex direction="column" gap="5" className="w-full">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Flex direction="column" gap="2">
                  <Text className="font-bold text-(--gray-12) text-2xl">
                    Install required tools
                  </Text>
                  <Text className="text-(--gray-11) text-sm">
                    These CLI tools are needed for code management and GitHub
                    workflows.
                  </Text>
                </Flex>
              </motion.div>

              {/* Git box */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
              >
                <Box
                  p="5"
                  style={{
                    boxShadow:
                      "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)",
                  }}
                  className="rounded-[12px] border border-(--gray-a3) bg-(--color-panel-solid)"
                >
                  <Flex direction="column" gap="3">
                    <Flex align="center" justify="between">
                      <Flex align="center" gap="2">
                        <GitBranch size={18} className="text-(--gray-12)" />
                        <Text className="font-bold text-(--gray-12) text-base">
                          Git
                        </Text>
                      </Flex>
                      {isLoadingGit && (
                        <CircleNotch
                          size={14}
                          className="animate-spin text-(--gray-9)"
                        />
                      )}
                      {!isLoadingGit && gitInstalled && (
                        <Flex align="center" gap="1">
                          <CheckCircle
                            size={14}
                            weight="fill"
                            className="text-(--green-9)"
                          />
                          <Text className="text-(--green-11) text-[13px]">
                            Installed
                            {gitStatus?.version
                              ? ` (${gitStatus.version})`
                              : ""}
                          </Text>
                        </Flex>
                      )}
                    </Flex>
                    {!isLoadingGit && !gitInstalled && (
                      <Flex direction="column" gap="3">
                        <Text className="text-(--gray-11) text-sm">
                          Install with Homebrew or Xcode Command Line Tools:
                        </Text>
                        <Flex direction="column" gap="2">
                          <CommandLine command="brew install git" />
                          <CommandLine command="xcode-select --install" />
                        </Flex>
                        <Flex align="center" justify="between" gap="3">
                          <Button
                            size="1"
                            variant="ghost"
                            color="gray"
                            onClick={() =>
                              trpcClient.os.openExternal.mutate({
                                url: EXTERNAL_LINKS.gitInstall,
                              })
                            }
                          >
                            Other install methods
                            <ArrowSquareOut size={12} />
                          </Button>
                          <Button
                            size="1"
                            variant="soft"
                            color="gray"
                            onClick={() => void handleCheckGit()}
                            loading={isCheckingGit}
                          >
                            <ArrowsClockwise size={12} />
                            Check again
                          </Button>
                        </Flex>
                      </Flex>
                    )}
                  </Flex>
                </Box>
              </motion.div>

              {/* GitHub CLI box */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
              >
                <Box
                  p="5"
                  style={{
                    boxShadow:
                      "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)",
                  }}
                  className="rounded-[12px] border border-(--gray-a3) bg-(--color-panel-solid)"
                >
                  <Flex direction="column" gap="3">
                    <Flex align="center" justify="between">
                      <Flex align="center" gap="2">
                        <GithubLogo size={18} className="text-(--gray-12)" />
                        <Text className="font-bold text-(--gray-12) text-base">
                          GitHub CLI
                        </Text>
                      </Flex>
                      {isLoadingGh && (
                        <CircleNotch
                          size={14}
                          className="animate-spin text-(--gray-9)"
                        />
                      )}
                      {!isLoadingGh && ghInstalled && ghAuthenticated && (
                        <Flex align="center" gap="1">
                          <CheckCircle
                            size={14}
                            weight="fill"
                            className="text-(--green-9)"
                          />
                          <Text className="text-(--green-11) text-[13px]">
                            {ghStatus?.username
                              ? `Logged in as ${ghStatus.username}`
                              : "Authenticated"}
                          </Text>
                        </Flex>
                      )}
                      {!isLoadingGh && ghInstalled && !ghAuthenticated && (
                        <Flex align="center" gap="1">
                          <Warning
                            size={14}
                            weight="fill"
                            className="text-(--amber-9)"
                          />
                          <Text className="text-(--amber-11) text-[13px]">
                            Not logged in
                          </Text>
                        </Flex>
                      )}
                    </Flex>
                    {!isLoadingGh && !ghInstalled && (
                      <Flex direction="column" gap="3">
                        <Text className="text-(--gray-11) text-sm">
                          Install with Homebrew:
                        </Text>
                        <CommandLine command="brew install gh" />
                        <Flex align="center" justify="between" gap="3">
                          <Button
                            size="1"
                            variant="ghost"
                            color="gray"
                            onClick={() =>
                              trpcClient.os.openExternal.mutate({
                                url: EXTERNAL_LINKS.ghInstall,
                              })
                            }
                          >
                            Other install methods
                            <ArrowSquareOut size={12} />
                          </Button>
                          <Button
                            size="1"
                            variant="soft"
                            color="gray"
                            onClick={() => void handleCheckGh()}
                            loading={isCheckingGh}
                          >
                            <ArrowsClockwise size={12} />
                            Check again
                          </Button>
                        </Flex>
                      </Flex>
                    )}
                    {!isLoadingGh && ghInstalled && !ghAuthenticated && (
                      <Flex direction="column" gap="3">
                        <Text className="text-(--gray-11) text-sm">
                          Run this in your terminal to log in:
                        </Text>
                        <CommandLine command="gh auth login" />
                        <Flex justify="end">
                          <Button
                            size="1"
                            variant="soft"
                            color="gray"
                            onClick={() => void handleCheckGh()}
                            loading={isCheckingGh}
                          >
                            <ArrowsClockwise size={12} />
                            Check again
                          </Button>
                        </Flex>
                      </Flex>
                    )}
                  </Flex>
                </Box>
              </motion.div>
            </Flex>

            <OnboardingHogTip
              hogSrc={builderHog}
              message="Agents use these tools to manage branches and open pull requests."
              delay={0.15}
            />
          </Flex>
        </Flex>

        <StepActions>
          <Button size="3" variant="outline" color="gray" onClick={onBack}>
            <ArrowLeft size={16} weight="bold" />
            Back
          </Button>
          {allReady ? (
            <Button size="3" onClick={onNext}>
              Continue
              <ArrowRight size={16} weight="bold" />
            </Button>
          ) : (
            <Button size="3" variant="outline" color="gray" onClick={onNext}>
              Skip for now
              <ArrowRight size={16} weight="bold" />
            </Button>
          )}
        </StepActions>
      </Flex>
    </Flex>
  );
}
