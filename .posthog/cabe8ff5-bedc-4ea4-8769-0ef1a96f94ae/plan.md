I'll analyze the codebase and create a detailed implementation plan for adding a context menu to tabs with "Close other tabs" and "Close tabs to the right" functionality.

Let me start by examining the current structure and understanding the dependencies:
Now let me check if ContextMenu from Radix UI is already being used and examine those implementations:
Perfect! Now let me check the package.json to see if Radix UI Context Menu is already installed:
Now let me check if there are additional methods needed in the tab store:
Perfect! Now I have all the information I need to create a comprehensive implementation plan. Let me present the plan:
# Implementation Plan: Context Menu for Tabs

**Task ID:** cabe8ff5-bedc-4ea4-8769-0ef1a96f94ae  
**Generated:** 2025-10-14

## Summary

This implementation will add right-click context menu functionality to tabs in the TabBar component, allowing users to:
1. **Close other tabs** - Closes all tabs except the one that was right-clicked
2. **Close tabs to the right** - Closes all tabs positioned to the right of the clicked tab

The implementation leverages the existing **Radix UI Themes ContextMenu** component (already installed and used in `TaskItem.tsx` and `LogView.tsx`) and extends the `tabStore` with two new methods for the closing operations.

## Implementation Steps

### 1. Analysis
- [x] **Identified relevant files**: `TabBar.tsx` and `tabStore.ts`
- [x] **Reviewed existing patterns**: 
  - `TaskItem.tsx` demonstrates comprehensive ContextMenu usage with multiple items, shortcuts, and sub-menus
  - `LogView.tsx` shows simpler ContextMenu implementation
  - Both use `@radix-ui/themes` ContextMenu (not the standalone package)
- [x] **Verified dependencies**: `@radix-ui/themes` already installed (v3.2.1), no additional packages needed
- [x] **Reviewed store patterns**: `closeTab` method exists and provides template for new methods

### 2. Changes Required

#### Files to Modify
1. **src/renderer/stores/tabStore.ts**
   - Add `closeOtherTabs(tabId: string)` to interface and implementation
   - Add `closeTabsToRight(tabId: string)` to interface and implementation

2. **src/renderer/components/TabBar.tsx**
   - Import `ContextMenu` from `@radix-ui/themes`
   - Import new store methods
   - Wrap tab elements with ContextMenu components
   - Add menu content with two action items

#### No Dependencies to Add
All required dependencies (`@radix-ui/themes`, `react`, `zustand`) are already installed.

### 3. Implementation

#### Core Functionality Changes

**A. Store Methods (tabStore.ts)**

Add to `TabStore` interface:
```typescript
closeOtherTabs: (tabId: string) => void;
closeTabsToRight: (tabId: string) => void;
```

Implementation logic:
- **closeOtherTabs**: 
  - Keep only the tab with the specified `tabId`
  - Set the kept tab as active
  - Ensure at least one tab remains (no-op if only one tab exists)
  
- **closeTabsToRight**:
  - Find index of the specified tab
  - Filter out all tabs with index > specified tab's index
  - Update `activeTabId` if current active tab is being closed (select the rightmost remaining tab)
  - No-op if the tab is already the rightmost tab

**B. TabBar Component Updates (TabBar.tsx)**

Structure for each tab:
```typescript
<ContextMenu.Root>
  <ContextMenu.Trigger>
    {/* Existing tab Flex component */}
  </ContextMenu.Trigger>
  <ContextMenu.Content>
    <ContextMenu.Item 
      disabled={tabs.length === 1}
      onSelect={() => closeOtherTabs(tab.id)}
    >
      Close other tabs
    </ContextMenu.Item>
    <ContextMenu.Item 
      disabled={index === tabs.length - 1}
      onSelect={() => closeTabsToRight(tab.id)}
    >
      Close tabs to the right
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>
```

Key integration points:
- Maintain existing drag-and-drop functionality
- Preserve keyboard shortcuts
- Keep existing close button behavior
- Maintain tab styling and interactions

#### Testing & Validation

Manual testing checklist:
- [ ] Right-click first tab → "Close other tabs" closes all others
- [ ] Right-click middle tab → both options work correctly
- [ ] Right-click last tab → "Close tabs to the right" is disabled
- [ ] Single tab → both options are disabled
- [ ] Active tab indicator updates correctly when active tab is closed
- [ ] At least one tab always remains open
- [ ] Existing keyboard shortcuts (Cmd/Ctrl+W, Cmd/Ctrl+Shift+[, etc.) still work
- [ ] Drag and drop still functions correctly
- [ ] Close button (X) on tabs still works

## File Changes

### New Files
```
None - No new files required
```

### Modified Files

**src/renderer/stores/tabStore.ts**
- Add `closeOtherTabs` method signature to `TabStore` interface (line ~11)
- Add `closeTabsToRight` method signature to `TabStore` interface (line ~12)
- Implement `closeOtherTabs` method in store (after `closeTab` method, ~line 70)
- Implement `closeTabsToRight` method in store (after `closeOtherTabs` method, ~line 80)

**src/renderer/components/TabBar.tsx**
- Add `ContextMenu` to imports from `@radix-ui/themes` (line 2)
- Destructure `closeOtherTabs` and `closeTabsToRight` from `useTabStore()` (line ~17)
- Wrap the tab `Flex` component (line ~137) with `ContextMenu.Root` and `ContextMenu.Trigger`
- Add `ContextMenu.Content` after the trigger with menu items
- Calculate disable conditions for menu items based on `tabs.length` and `index`

## Considerations

### Key Architectural Decisions

1. **Using Radix UI Themes ContextMenu**: Following existing patterns in the codebase (`TaskItem.tsx`, `LogView.tsx`) rather than introducing the standalone `@radix-ui/react-context-menu` package
   
2. **Store-based operations**: All closing logic is handled in the Zustand store, keeping components focused on UI concerns

3. **Consistency with existing patterns**: The context menu structure mirrors `TaskItem.tsx` which has sophisticated menu handling

### Potential Risks and Mitigation

**Risk**: Closing tabs might interfere with drag-and-drop operations
- **Mitigation**: Context menu trigger wraps the existing tab element without modifying its event handlers

**Risk**: Active tab selection might behave unexpectedly when multiple tabs are closed
- **Mitigation**: Store methods explicitly handle active tab reassignment, selecting appropriate fallback tabs

**Risk**: User might accidentally close all important tabs
- **Mitigation**: Always keep at least one tab open; consider adding confirmation for destructive actions (future enhancement)

### Testing Approach

1. **Edge Case Testing**:
   - Single tab scenario (both options disabled)
   - Last tab scenario (close right disabled)
   - Closing active tab (verify proper tab selection)
   - Multiple rapid operations

2. **Integration Testing**:
   - Verify keyboard shortcuts remain functional
   - Test drag-and-drop still works
   - Ensure tab reordering doesn't affect context menu behavior

3. **User Experience Testing**:
   - Context menu appears on right-click
   - Menu items are appropriately disabled
   - Visual feedback is clear
   - Operations complete as expected

### Additional Notes

- The implementation should maintain the current tab persistence (handled by Zustand persist middleware)
- No changes to the tab types are needed (`TabState` interface remains unchanged)
- The context menu should follow the theme of the application (handled automatically by Radix UI Themes)
- Consider adding keyboard shortcuts for these actions in a future iteration (e.g., similar to browser behavior)

---

*Generated by PostHog AI Coding Agent*