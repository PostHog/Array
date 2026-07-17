import { compactHomePath } from "@posthog/shared";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { isCancelOption, isSubmitOption } from "./constants";
import { OptionRow } from "./OptionRow";
import { StepTabs } from "./StepTabs";
import type { ActionSelectorProps } from "./types";
import { useActionSelectorState } from "./useActionSelectorState";

// Floor keeps the options and submit row visible even at the smallest size;
// ceiling matches the card's default `max-h-[80vh]` cap.
const MIN_CARD_HEIGHT = 160;
const MAX_CARD_HEIGHT_FRACTION = 0.8;

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
  initialCustomInput,
  hideSubmitButton = false,
  resizable = false,
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
    initialCustomInput,
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

  // User-chosen height in px once the card has been dragged; null means the
  // card sizes naturally under its `max-h-[80vh]` cap.
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef({ y: 0, height: 0 });

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      e.preventDefault();
      resizeStartRef.current = {
        y: e.clientY,
        height: container.getBoundingClientRect().height,
      };
      setIsResizing(true);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [containerRef],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const { y, height } = resizeStartRef.current;
      // Dragging up (clientY decreases) grows the card; down shrinks it,
      // revealing more of the transcript above.
      const next = height + (y - e.clientY);
      const max = window.innerHeight * MAX_CARD_HEIGHT_FRACTION;
      setCardHeight(Math.max(MIN_CARD_HEIGHT, Math.min(max, next)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  // If the card unmounts mid-drag no mouseup fires — clear the global cursor
  // and text-selection lock so the app isn't left stuck.
  const isResizingRef = useRef(isResizing);
  isResizingRef.current = isResizing;
  useEffect(
    () => () => {
      if (isResizingRef.current) {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    },
    [],
  );

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
    hasCancel: onCancel !== undefined,
  });
  stateRef.current = {
    showInlineEdit,
    hasSteps,
    showSubmitButton,
    multiSelect,
    hasCancel: onCancel !== undefined,
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const {
        showInlineEdit,
        hasSteps,
        showSubmitButton,
        multiSelect,
        hasCancel,
      } = stateRef.current;
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
          // Nothing to cancel — let Escape bubble instead of swallowing it.
          if (!hasCancel) break;
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
        ...(resizable && cardHeight !== null ? { height: cardHeight } : {}),
      }}
      className="relative flex max-h-[80vh] flex-col rounded-(--radius-3) border border-(--gray-6) bg-(--gray-1)"
    >
      {resizable && (
        // Drag handle riding the top edge — the card is anchored to the bottom
        // of the chat, so dragging up grows it and dragging down shrinks it.
        <Box
          aria-hidden
          onMouseDown={handleResizeMouseDown}
          className="group absolute inset-x-0 top-0 z-10 flex h-2 cursor-row-resize items-start justify-center"
        >
          <span
            className={`mt-0.5 h-1 w-10 rounded-full transition-colors ${
              isResizing
                ? "bg-(--gray-8)"
                : "bg-(--gray-6) group-hover:bg-(--gray-8)"
            }`}
          />
        </Box>
      )}
      {isResizing && (
        // Keeps the row-resize cursor while the pointer crosses content that
        // sets its own cursor.
        <Box className="fixed inset-0 z-[200] cursor-row-resize" />
      )}
      <Flex direction="column" gap="2" className="min-h-0 flex-1">
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

        {(pendingAction || question) && (
          <Box className="min-h-0 flex-1 overflow-y-auto">
            {pendingAction && (
              <Box mb={question ? "2" : "0"}>{pendingAction}</Box>
            )}
            {question && (
              <Text as="p" className="text-[13px]">
                {question}
              </Text>
            )}
          </Box>
        )}

        <Box>
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
            Enter to select · Tab/Arrow keys to navigate
            {onCancel ? " · Esc to cancel" : ""}
          </Text>
        </Box>
      </Flex>
    </Box>
  );
}
