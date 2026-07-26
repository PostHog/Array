import {
  type ArchivedTaskWithRepo,
  type ArchiveFilterSortInput,
  filterAndSortArchivedTasks,
} from "@posthog/core/archive/archiveListView";

export function getVisibleArchivedTasks(
  items: ArchivedTaskWithRepo[],
  filters: ArchiveFilterSortInput,
  loadedCount: number,
): ArchivedTaskWithRepo[] {
  return filterAndSortArchivedTasks(items, filters).slice(0, loadedCount);
}
