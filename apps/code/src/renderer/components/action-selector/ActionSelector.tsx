import { Box, Flex, Text } from "@radix-ui/themes";
import { compactHomePath } from "@utils/path";
import { useCallback, useEffect, useRef } from "react";
import { isCancelOption, isSubmitOption } from "./constants";
import { OptionRow } from "./OptionRow";
import { StepTabs } from "./StepTabs";
import type { ActionSelectorProps } from "./types";
import { useActionSelectorState } from "./useActionSelectorState";

export function ActionSelector({
  title,
  pendingAction,
  question,
  options,
  multiSelect = false,
  allowCustomInput = false,
  customInputPlaceholder = "Type your answer...",
  currentStep = 0,
  steps,
  initialSelections,
  hideSubmitButton = false,
  onSelect,
  onMultiSelect,
  onCancel,
  onStepChange,
  onStepAnswer,
}: ActionSelectorProps) {
  const state = useActionSelectorState({
    options,
    multiSelect,
    allowCustomInput,
    hideSubmitButton,
    currentStep,
    steps,
    initialSelections,
    onSelect,
    onMultiSelect,
    onStepChange,
    onStepAnswer,
  });

  const {
    selectedIndex,
    hoveredIndex,
    setHoveredIndex,
    checkedOptions,
    customInput,
    setCustomInput,
    activeStep,
    stepAnswers,
    containerRef,
    hasSteps,
    numSteps,
    showSubmitButton,
    canSubmitOrAdvance,
    allOptions,
    showInlineEdit,
    moveUp,
    moveDown,
    moveToPrevStep,
    moveToNextStep,
    selectCurrent,
    handleClick,
    handleStepClick,
    handleEscape,
    handleInlineSubmit,
    handleNavigateUp,
    handleNavigateDown,
    handleSubmitMulti,
    handleSubmitSingle,
  } = state;

  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  const handlersRef = useRef({
    moveUp,
    moveDown,
    moveToPrevStep,
    moveToNextStep,
    selectCurrent,
    handleSubmitMulti,
    handleSubmitSingle,
    handleCancel,
    handleClick,
  });
  handlersRef.current = {
    moveUp,
    moveDown,
    moveToPrevStep,
    moveToNextStep,
    selectCurrent,
    handleSubmitMulti,
    handleSubmitSingle,
    handleCancel,
    handleClick,
  };

  const stateRef = useRef({
    showInlineEdit,
    hasSteps,
    showSubmitButton,
    multiSelect,
  });
  stateRef.current = {
    showInlineEdit,
    hasSteps,
    showSubmitButton,
    multiSelect,
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { showInlineEdit, hasSteps, showSubmitButton, multiSelect } =
        stateRef.current;
      const h = handlersRef.current;

      if (showInlineEdit || document.activeElement?.tagName === "TEXTAREA")
        return;

      const container = containerRef.current;
      if (
        container &&
        container !== document.activeElement &&
        !container.contains(document.activeElement)
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          h.moveUp();
          break;
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          h.moveDown();
          break;
        case "ArrowLeft":
          if (hasSteps) {
            e.preventDefault();
            e.stopPropagation();
            h.moveToPrevStep();
          }
          break;
        case "ArrowRight":
          if (hasSteps) {
            e.preventDefault();
            e.stopPropagation();
            h.moveToNextStep();
          }
          break;
        case "Tab":
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            hasSteps ? h.moveToPrevStep() : h.moveUp();
          } else {
            hasSteps ? h.moveToNextStep() : h.moveDown();
          }
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey && showSubmitButton) {
            multiSelect ? h.handleSubmitMulti() : h.handleSubmitSingle();
          } else {
            h.selectCurrent();
          }
          break;
        case " ":
          if (showSubmitButton) {
            e.preventDefault();
            e.stopPropagation();
            h.selectCurrent();
          }
          break;
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          h.handleCancel();
          break;
        default:
          if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            h.handleClick(Number.parseInt(e.key, 10) - 1);
          }
          break;
      }
    };

    document.addEventListener("keydown", handler, { capture: true });
    return () =>
      document.removeEventListener("keydown", handler, { capture: true });
  }, [containerRef.current]);

  const getSubmitLabel = () => {
    return hasSteps && activeStep < numSteps - 1 ? "Next" : "Submit";
  };

  return (
    <Box
      ref={containerRef}
      tabIndex={0}
      p="3"
      onClick={(e) => {
        if (e.target instanceof HTMLInputElement) {
          return;
        }
        containerRef.current?.focus();
      }}
      style={{
        outline: "none",
      }}
      className="rounded-(--radius-3) border border-(--gray-6) bg-(--gray-1)"
    >
      <Flex direction="column" gap="2">
        {hasSteps && steps && (
          <StepTabs
            steps={steps}
            activeStep={activeStep}
            stepAnswers={stepAnswers}
            onStepClick={handleStepClick}
          />
        )}

        {title &&
          (typeof title === "string" ? (
            <Text
              className="font-medium text-[13px] text-primary"
              title={title}
            >
              {compactHomePath(title)}
            </Text>
          ) : (
            <Text className="font-medium text-[13px] text-primary">
              {title}
            </Text>
          ))}

        {pendingAction && <Box>{pendingAction}</Box>}

        <Box>
          <Text mb="2" as="p" className="text-[13px]">
            {question}
          </Text>

          <Flex direction="column" gap="1" px="2">
            {allOptions.map((option, index) => {
              if (isSubmitOption(option.id) || isCancelOption(option.id)) {
                return null;
              }
              const isSelected = selectedIndex === index;
              const isHovered = hoveredIndex === index;
              const isChecked = checkedOptions.has(option.id);

              return (
                <OptionRow
                  key={option.id}
                  option={option}
                  index={index}
                  isSelected={isSelected}
                  isHovered={isHovered}
                  isChecked={isChecked}
                  showCheckbox={showSubmitButton}
                  multiSelect={multiSelect}
                  customInput={customInput}
                  customInputPlaceholder={customInputPlaceholder}
                  isEditing={showInlineEdit && isSelected}
                  submitLabel={getSubmitLabel()}
                  onCustomInputChange={setCustomInput}
                  onNavigateUp={handleNavigateUp}
                  onNavigateDown={handleNavigateDown}
                  onEscape={handleEscape}
                  onInlineSubmit={handleInlineSubmit}
                  onClick={() => handleClick(index)}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                />
              );
            })}
          </Flex>

          <Flex direction="row" gap="2" mt="2">
            {allOptions.map((option, index) => {
              if (!isSubmitOption(option.id) && !isCancelOption(option.id)) {
                return null;
              }
              const isSelected = selectedIndex === index;

              const isHovered = hoveredIndex === index;
              const isDisabled =
                isSubmitOption(option.id) &&
                showSubmitButton &&
                !canSubmitOrAdvance;
              return (
                <OptionRow
                  key={option.id}
                  option={option}
                  index={index}
                  isSelected={isSelected}
                  isHovered={isHovered}
                  isChecked={false}
                  showCheckbox={false}
                  multiSelect={multiSelect}
                  customInput=""
                  customInputPlaceholder=""
                  isEditing={false}
                  submitLabel={getSubmitLabel()}
                  disabled={isDisabled}
                  onCustomInputChange={setCustomInput}
                  onNavigateUp={handleNavigateUp}
                  onNavigateDown={handleNavigateDown}
                  onEscape={handleEscape}
                  onInlineSubmit={handleInlineSubmit}
                  onClick={() => handleClick(index)}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                />
              );
            })}
          </Flex>

          <Text color="gray" mt="2" as="p" className="text-[13px]">
            Enter to select · Tab/Arrow keys to navigate · Esc to cancel
          </Text>
        </Box>
      </Flex>
    </Box>
  );
}
