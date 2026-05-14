import SwiftUI
import WatchKit

private let accent = Color.orange

func formatElapsed(_ seconds: Int) -> String {
  if seconds >= 3600 { return "\(seconds / 3600)h \((seconds % 3600) / 60)m" }
  if seconds >= 60 { return "\(seconds / 60)m \(seconds % 60)s" }
  return "\(seconds)s"
}

func statusColor(_ status: String) -> Color {
  switch status {
  case "completed": return .green
  case "failed": return .red
  case "blocked", "waiting_for_approval", "stale": return .orange
  case "running": return .secondary
  case "connecting": return .blue
  default: return .secondary
  }
}

func shortTime(_ milliseconds: TimeInterval?) -> String {
  guard let milliseconds else { return "" }
  let date = Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000)
  let hours = Date().timeIntervalSince(date) / 3600
  if hours < 24 {
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    return formatter.localizedString(for: date, relativeTo: Date())
  }
  let formatter = DateFormatter()
  formatter.setLocalizedDateFormatFromTemplate("MMM d")
  return formatter.string(from: date)
}

func taskRepositoryLabel(_ task: WatchTaskSnapshot) -> String {
  let repo = task.repository?.trimmingCharacters(in: .whitespacesAndNewlines)
  return repo?.isEmpty == false ? repo! : "No repository"
}

struct TaskRepositorySection: Identifiable {
  let id: String
  let tasks: [WatchTaskSnapshot]
}

func groupTasksByRepository(_ tasks: [WatchTaskSnapshot]) -> [TaskRepositorySection] {
  let grouped = Dictionary(grouping: tasks, by: taskRepositoryLabel)
  return grouped.map { label, tasks in
    TaskRepositorySection(
      id: label,
      tasks: tasks.sorted { ($0.updatedAt ?? $0.generatedAt) > ($1.updatedAt ?? $1.generatedAt) }
    )
  }
  .sorted { lhs, rhs in
    if lhs.id == "No repository" { return false }
    if rhs.id == "No repository" { return true }
    let lhsTime = lhs.tasks.first?.updatedAt ?? lhs.tasks.first?.generatedAt ?? 0
    let rhsTime = rhs.tasks.first?.updatedAt ?? rhs.tasks.first?.generatedAt ?? 0
    return lhsTime > rhsTime
  }
}

enum WatchTaskOrganizeMode: String, CaseIterable {
  case byProject
  case chronological
}

enum WatchTaskSortMode: String, CaseIterable {
  case updated
  case created
}

enum WatchTaskVisibility: String, CaseIterable {
  case external
  case internalOnly = "internal"
  case all
}

struct TasksRootView: View {
  @EnvironmentObject private var store: WatchTaskStore
  @State private var selectedTaskId: String?
  @AppStorage("watch_task_organize_mode") private var organizeModeRaw = WatchTaskOrganizeMode.chronological.rawValue
  @AppStorage("watch_task_sort_mode") private var sortModeRaw = WatchTaskSortMode.updated.rawValue
  @AppStorage("watch_task_visibility") private var visibilityRaw = WatchTaskVisibility.external.rawValue
  @AppStorage("watch_task_show_archived") private var showArchived = false

  private var organizeMode: WatchTaskOrganizeMode {
    WatchTaskOrganizeMode(rawValue: organizeModeRaw) ?? .chronological
  }

  private var sortMode: WatchTaskSortMode {
    WatchTaskSortMode(rawValue: sortModeRaw) ?? .updated
  }

  private var visibility: WatchTaskVisibility {
    WatchTaskVisibility(rawValue: visibilityRaw) ?? .external
  }

  private var visibleTasks: [WatchTaskSnapshot] {
    store.tasks
      .filter { task in
        switch visibility {
        case .external: return task.internal != true
        case .internalOnly: return task.internal == true
        case .all: return true
        }
      }
  }

  private var activeTasks: [WatchTaskSnapshot] {
    visibleTasks
      .filter { $0.isArchived != true }
      .sorted { taskSortTimestamp($0) > taskSortTimestamp($1) }
  }

  private var archivedTasks: [WatchTaskSnapshot] {
    guard showArchived else { return [] }
    return visibleTasks
      .filter { $0.isArchived == true }
      .sorted { taskSortTimestamp($0) > taskSortTimestamp($1) }
  }

  var body: some View {
    NavigationStack {
      if store.envelope?.isAuthenticated == false {
        SignedOutWatchView(state: store.connectionState)
      } else if store.tasks.isEmpty {
        EmptyTasksView(state: store.connectionState)
      } else {
        List {
          Button { promptForNewTask() } label: {
            Label("New Task", systemImage: "plus")
          }
          .tint(accent)

          NavigationLink { TaskListSettingsView() } label: {
            Label("Filter & Sort", systemImage: "line.3.horizontal.decrease.circle")
          }

          if activeTasks.isEmpty && archivedTasks.isEmpty {
            Text(showArchived ? "No matching tasks" : "No active tasks")
              .font(.caption)
              .foregroundStyle(.secondary)
          } else {
            if organizeMode == .byProject {
              ForEach(groupTasksByRepository(activeTasks)) { section in
                Section(header: ProjectSectionHeader(title: section.id, count: section.tasks.count)) {
                  ForEach(section.tasks) { task in
                    taskLink(task)
                  }
                }
              }
            } else {
              ForEach(activeTasks) { taskLink($0) }
            }

            if !archivedTasks.isEmpty {
              Section(header: ArchivedSectionHeader(count: archivedTasks.count)) {
                ForEach(archivedTasks) { taskLink($0) }
              }
            }
          }
        }
        .navigationTitle("Tasks")
        .navigationDestination(item: $selectedTaskId) { id in
          let task = store.tasks.first(where: { $0.id == id })
          TaskOverviewView(task: task)
        }
        .refreshable {
          store.requestSnapshot()
        }
      }
    }
  }

  private func taskSortTimestamp(_ task: WatchTaskSnapshot) -> TimeInterval {
    if sortMode == .created { return task.createdAt ?? task.generatedAt }
    return task.updatedAt ?? task.generatedAt
  }

  private func taskLink(_ task: WatchTaskSnapshot) -> some View {
    Button {
      selectedTaskId = task.id
    } label: {
      TaskRow(task: task, isActive: store.envelope?.activeTaskId == task.id)
    }
    .opacity(task.isArchived == true ? 0.45 : 1)
    .contextMenu {
      if task.isArchived == true {
        Button("Restore") { sendArchiveCommand(task, type: "restore") }
      } else {
        Button("Archive", role: .destructive) { sendArchiveCommand(task, type: "archive") }
      }
    }
  }

  private func sendArchiveCommand(_ task: WatchTaskSnapshot, type: String) {
    store.send(command: WatchTaskCommand(id: UUID().uuidString, type: type, taskId: task.taskId, taskRunId: task.taskRunId, toolCallId: nil, optionId: nil, displayText: nil, answers: nil, customInput: nil, url: nil))
  }

  private func promptForNewTask() {
    presentNewTaskInput { prompt in
      store.send(command: WatchTaskCommand(
        id: UUID().uuidString,
        type: "create_task",
        taskId: "new",
        taskRunId: nil,
        toolCallId: nil,
        optionId: nil,
        displayText: prompt,
        answers: nil,
        customInput: prompt,
        url: nil
      ))
    }
  }
}

struct ConnectivityIndicator: View {
  let state: String

  var body: some View {
    HStack(spacing: 4) {
      Circle()
        .fill(state == "Live" || state == "Connected" || state == "Cached" ? .green : .orange)
        .frame(width: 6, height: 6)
      Text(state)
        .font(.caption2)
        .foregroundStyle(.secondary)
    }
  }
}

struct SignedOutWatchView: View {
  let state: String

  var body: some View {
    VStack(spacing: 10) {
      ConnectivityIndicator(state: state)
      Image(systemName: "iphone.and.arrow.forward")
        .font(.title2)
        .foregroundStyle(accent)
      Text("Sign in on iPhone").font(.headline)
      Text("Open the PostHog app on your iPhone and log in to sync tasks to your watch.")
        .font(.caption2)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }
    .padding()
  }
}

struct EmptyTasksView: View {
  @EnvironmentObject private var store: WatchTaskStore
  let state: String

  var body: some View {
    VStack(spacing: 10) {
      ConnectivityIndicator(state: state)
      Text("✨").font(.title2)
      Text("No tasks yet").font(.headline)
      Text("Create your first task to get PostHog working.")
        .font(.footnote)
        .foregroundStyle(.secondary)
        .lineLimit(0)
        .multilineTextAlignment(.center)
      Button(action: promptForNewTask) {
        Label("New Task", systemImage: "plus")
      }
      .buttonStyle(.borderedProminent)
      .tint(accent)
    }
    .padding()
  }

  private func promptForNewTask() {
    presentNewTaskInput { prompt in
      store.send(command: WatchTaskCommand(
        id: UUID().uuidString,
        type: "create_task",
        taskId: "new",
        taskRunId: nil,
        toolCallId: nil,
        optionId: nil,
        displayText: prompt,
        answers: nil,
        customInput: prompt,
        url: nil
      ))
    }
  }
}

func presentNewTaskInput(includeSuggestions: Bool = true, _ completion: @escaping (String) -> Void) {
  let suggestions = includeSuggestions
    ? [
      "Create or update my CLAUDE.md file",
      "Search for a TODO comment and fix it",
      "Recommend areas to improve our tests",
    ]
    : nil
  WKExtension.shared().visibleInterfaceController?.presentTextInputController(
    withSuggestions: suggestions,
    allowedInputMode: .plain
  ) { results in
    let firstNonEmpty = results?
      .compactMap { $0 as? String }
      .first(where: {
        $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
      })
    guard let prompt = firstNonEmpty else { return }
    completion(prompt)
  }
}

struct ProjectSectionHeader: View {
  let title: String
  let count: Int

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: "arrow.triangle.branch")
        .font(.system(size: 9, weight: .semibold))
      Text(title)
        .font(.footnote)
        .truncationMode(.middle)
        .lineLimit(1)
      Spacer()
      Text("\(count)")
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
    .listRowInsets(EdgeInsets())
    .foregroundStyle(.secondary)
  }
}

struct ArchivedSectionHeader: View {
  let count: Int

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: "archivebox")
        .font(.system(size: 9, weight: .semibold))
      Text("Archived")
        .font(.system(size: 10, weight: .semibold, design: .rounded))
      Text("\(count)")
        .font(.system(size: 9, weight: .medium, design: .rounded))
        .foregroundStyle(.secondary)
    }
    .foregroundStyle(.secondary)
  }
}

struct TaskRow: View {
  let task: WatchTaskSnapshot
  let isActive: Bool

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      TaskStatusDot(task: task)
        .padding(.top, 2)
      VStack(alignment: .leading, spacing: 3) {
        HStack(alignment: .firstTextBaseline) {
          Text(task.title).font(.caption).lineLimit(1)
          Spacer(minLength: 4)
          Text(shortTime(task.createdAt))
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
        }
        if let subtitle = task.subtitle, !subtitle.isEmpty {
          Text(subtitle)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        HStack(spacing: 4) {
          if task.isArchived == true { Text("Archived") }
          if task.progress.total > 0 { Text("\(task.progress.completed)/\(task.progress.total)") }
        }
        .font(.system(size: 9))
        .foregroundStyle(.secondary)
      }
    }
  }
}

struct TaskStatusDot: View {
  let task: WatchTaskSnapshot

  var body: some View {
    ZStack {
      Circle()
        .stroke(statusColor(task.status).opacity(0.35), lineWidth: 2)
        .frame(width: 14, height: 14)
      if task.status == "running" || task.status == "connecting" {
        ProgressView()
          .progressViewStyle(.circular)
          .tint(statusColor(task.status))
          .frame(width: 14, height: 14)
      } else if task.status == "completed" {
        Image(systemName: "checkmark.circle.fill")
          .font(.system(size: 14))
          .foregroundStyle(statusColor(task.status))
      } else if task.status == "failed" || task.status == "blocked" {
        Image(systemName: "xmark.circle.fill")
          .font(.system(size: 14))
          .foregroundStyle(statusColor(task.status))
      } else if task.status == "waiting_for_approval" {
        Image(systemName: "exclamationmark.circle.fill")
          .font(.system(size: 14))
          .foregroundStyle(statusColor(task.status))
      } else {
        Circle()
          .fill(statusColor(task.status))
          .frame(width: 7, height: 7)
      }
    }
  }
}

struct TaskListSettingsView: View {
  @AppStorage("watch_task_organize_mode") private var organizeModeRaw = WatchTaskOrganizeMode.chronological.rawValue
  @AppStorage("watch_task_sort_mode") private var sortModeRaw = WatchTaskSortMode.updated.rawValue
  @AppStorage("watch_task_visibility") private var visibilityRaw = WatchTaskVisibility.external.rawValue
  @AppStorage("watch_task_show_archived") private var showArchived = false

  var body: some View {
    Form {
      Picker("Group by", selection: $organizeModeRaw) {
        Text("Project").tag(WatchTaskOrganizeMode.byProject.rawValue)
        Text("None").tag(WatchTaskOrganizeMode.chronological.rawValue)
      }
      Picker("Sort by", selection: $sortModeRaw) {
        Text("Updated").tag(WatchTaskSortMode.updated.rawValue)
        Text("Created").tag(WatchTaskSortMode.created.rawValue)
      }
      Picker("Visibility", selection: $visibilityRaw) {
        Text("External").tag(WatchTaskVisibility.external.rawValue)
        Text("Internal").tag(WatchTaskVisibility.internalOnly.rawValue)
        Text("All").tag(WatchTaskVisibility.all.rawValue)
      }
      Toggle("Show archived", isOn: $showArchived)
    }
    .navigationTitle("Filter")
  }
}

struct TaskOverviewView: View {
  @EnvironmentObject private var store: WatchTaskStore
  let task: WatchTaskSnapshot?

  private var currentTask: WatchTaskSnapshot? {
    guard let id = task?.id else { return task }
    return store.tasks.first(where: { $0.id == id }) ?? task
  }

  var body: some View {
    ScrollView {
      if let task = currentTask {
        VStack(alignment: .leading, spacing: 12) {
          VStack(alignment: .leading, spacing: 6) {
            Text(task.title)
              .font(.headline)
              .lineLimit(3)
            Text(task.statusText)
              .font(.caption)
              .foregroundStyle(statusColor(task.status))
          }

          CurrentTaskCard(task: task)

          VStack(spacing: 6) {
            Button("Open on iPhone") { send(type: "open_phone", task: task, url: task.handoff.phoneUrl, prompt: nil) }
            Button { promptForTask(task) } label: {
              Label("Tap to Speak", systemImage: "mic")
            }
            .buttonStyle(.borderedProminent)
            .tint(accent)
            if task.allowedActions.contains("stop") {
              Button("Stop Agent") { send(type: "stop", task: task, url: nil, prompt: nil) }.tint(.red)
            }
          }

          if let approval = task.approval { ApprovalCard(task: task, approval: approval) }
          if let blocker = task.blocker, task.approval == nil { BlockerCard(task: task, blocker: blocker) }

          if let status = store.lastCommandStatus {
            Text(status).font(.caption2).foregroundStyle(.secondary)
          }
        }
        .padding(.vertical, 4)
      } else {
        ContentUnavailableView(
          "Task unavailable",
          systemImage: "exclamationmark.triangle",
          description: Text("Pull to refresh tasks.")
        )
      }
    }
    .navigationTitle("Task")
  }

  private func promptForTask(_ task: WatchTaskSnapshot) {
    presentNewTaskInput(includeSuggestions: false) { prompt in
      send(type: "open_task_prompt", task: task, url: task.handoff.phoneUrl, prompt: prompt)
    }
  }

  private func send(type: String, task: WatchTaskSnapshot, url: String?, prompt: String?) {
    store.send(command: WatchTaskCommand(
      id: UUID().uuidString,
      type: type,
      taskId: task.taskId,
      taskRunId: task.taskRunId,
      toolCallId: nil,
      optionId: nil,
      displayText: prompt,
      answers: nil,
      customInput: prompt,
      url: url
    ))
  }
}

struct TaskHeader: View {
  let task: WatchTaskSnapshot

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .top) {
        if task.progress.total > 0 {
          ZStack {
            ProgressView(value: task.progress.fraction)
              .progressViewStyle(.circular)
              .tint(statusColor(task.status))
            Text("\(Int(task.progress.fraction * 100))")
              .font(.system(size: 10, weight: .bold, design: .rounded))
          }
        }
        VStack(alignment: .leading, spacing: 2) {
          if let slug = task.slug {
            Text(slug).font(.caption2).foregroundStyle(.secondary)
          }
          Text(task.title).font(.headline).lineLimit(2)
          Text(task.statusText).font(.caption).foregroundStyle(statusColor(task.status))
        }
      }
      HStack(spacing: 6) {
        Chip(text: task.environment == "local" ? "Local" : task.environment.capitalized)
        Chip(text: formatElapsed(task.elapsedSeconds))
        if task.isStale { Chip(text: "Stale", color: .orange) }
      }
      if task.progress.total > 0 {
        Text("\(task.progress.completed)/\(task.progress.total) done")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
    }
  }
}

struct Chip: View {
  let text: String
  var color: Color = .secondary

  var body: some View {
    Text(text)
      .font(.caption2)
      .padding(.horizontal, 6)
      .padding(.vertical, 3)
      .background(color.opacity(0.18), in: Capsule())
  }
}

struct CurrentTaskCard: View {
  let task: WatchTaskSnapshot

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("Current").font(.caption2).foregroundStyle(.secondary)
      Text(task.currentTask ?? "Waiting for next step").font(.caption).lineLimit(3)
    }
    .padding(10)
    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
  }
}

struct ChecklistView: View {
  let task: WatchTaskSnapshot

  var body: some View {
    List(task.checklist) { item in
      HStack(alignment: .top, spacing: 8) {
        Image(systemName: icon(for: item.status))
          .foregroundStyle(statusColor(item.status == "running" ? "running" : item.status))
        VStack(alignment: .leading, spacing: 2) {
          Text(item.title).font(.caption)
          if let subtitle = item.subtitle {
            Text(subtitle).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
          }
        }
      }
    }
    .navigationTitle("Checklist")
  }

  private func icon(for status: String) -> String {
    switch status {
    case "completed": return "checkmark.circle.fill"
    case "running": return "arrow.triangle.2.circlepath.circle.fill"
    case "failed": return "xmark.octagon.fill"
    default: return "circle"
    }
  }
}

struct TimelineView: View {
  let task: WatchTaskSnapshot

  var body: some View {
    List(task.timeline) { item in
      VStack(alignment: .leading, spacing: 3) {
        Text(item.title).font(.caption)
        if let detail = item.detail {
          Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(3)
        }
      }
    }
    .navigationTitle("Timeline")
  }
}

struct ApprovalCard: View {
  @EnvironmentObject private var store: WatchTaskStore
  let task: WatchTaskSnapshot
  let approval: WatchTaskApproval

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label(approval.risk == "destructive" ? "High-risk approval" : "Approval needed", systemImage: "exclamationmark.triangle.fill")
        .font(.caption)
        .foregroundStyle(.orange)
      Text(approval.summary).font(.caption).lineLimit(4)
      if let detail = approval.detail { Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(2) }
      ForEach(approval.options) { option in
        Button(option.title) { sendApproval(option) }
          .buttonStyle(.borderedProminent)
          .tint(option.role == "reject" ? .red : accent)
      }
      if approval.diffAvailable == true {
        Button("View Diff") { send(type: "view_diff", url: task.handoff.phoneUrl) }
      }
    }
    .padding(10)
    .background(.orange.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
  }

  private func sendApproval(_ option: WatchTaskApprovalOption) {
    store.send(command: WatchTaskCommand(
      id: UUID().uuidString,
      type: "approval_response",
      taskId: task.taskId,
      taskRunId: task.taskRunId,
      toolCallId: approval.toolCallId,
      optionId: option.id,
      displayText: option.title,
      answers: nil,
      customInput: nil,
      url: nil
    ))
  }

  private func send(type: String, url: String?) {
    store.send(command: WatchTaskCommand(id: UUID().uuidString, type: type, taskId: task.taskId, taskRunId: task.taskRunId, toolCallId: nil, optionId: nil, displayText: nil, answers: nil, customInput: nil, url: url))
  }
}

struct BlockerCard: View {
  @EnvironmentObject private var store: WatchTaskStore
  let task: WatchTaskSnapshot
  let blocker: WatchTaskBlocker

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label(blocker.title, systemImage: blocker.kind == "stale" ? "wifi.slash" : "xmark.octagon.fill")
        .font(.caption)
        .foregroundStyle(blocker.kind == "stale" ? .orange : .red)
      if let detail = blocker.detail { Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(4) }
      HStack {
        Button("Retry") { send(type: "retry") }
        Button("Stop") { send(type: "stop") }.tint(.red)
      }
    }
    .padding(10)
    .background(.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
  }

  private func send(type: String) {
    store.send(command: WatchTaskCommand(id: UUID().uuidString, type: type, taskId: task.taskId, taskRunId: task.taskRunId, toolCallId: nil, optionId: nil, displayText: nil, answers: nil, customInput: nil, url: nil))
  }
}

struct HandoffButtons: View {
  @EnvironmentObject private var store: WatchTaskStore
  let task: WatchTaskSnapshot

  var body: some View {
    VStack(spacing: 6) {
      Button("Open on iPhone") { send(type: "open_phone", url: task.handoff.phoneUrl) }
      Button("Send Demo Prompt") { sendDemoPrompt() }
      if task.allowedActions.contains("stop") { Button("Stop Agent") { send(type: "stop", url: nil) }.tint(.red) }
    }
  }

  private func send(type: String, url: String?) {
    store.send(command: WatchTaskCommand(id: UUID().uuidString, type: type, taskId: task.taskId, taskRunId: task.taskRunId, toolCallId: nil, optionId: nil, displayText: nil, answers: nil, customInput: nil, url: url))
  }

  private func sendDemoPrompt() {
    store.send(command: WatchTaskCommand(id: UUID().uuidString, type: "send_prompt", taskId: task.taskId, taskRunId: task.taskRunId, toolCallId: nil, optionId: nil, displayText: "Demo prompt from Apple Watch", answers: nil, customInput: nil, url: nil))
  }
}

struct WatchHomeView: View {
  @EnvironmentObject private var store: WatchTaskStore

  var body: some View {
    NavigationStack {
      List {
//        Button { store.requestSnapshot() } label: {
//          Label("Refresh", systemImage: "arrow.clockwise")
//          .font(.caption2)
//        }
//        .buttonStyle(.plain)
        NavigationLink { TasksRootView() } label: {
          Label {
            VStack(alignment: .leading, spacing: 2) {
              Text("Tasks")
              Text("\(store.tasks.count) synced")
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
          } icon: {
            Image(systemName: "checklist")
          }
        }
        NavigationLink { InboxListView() } label: {
          Label {
            VStack(alignment: .leading, spacing: 2) {
              Text("Inbox")
              Text("\((store.envelope?.inboxReports ?? []).count) reports")
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
          } icon: {
            Image(systemName: "tray")
          }
        }
        NavigationLink { AutomationsListView() } label: {
          Label {
            VStack(alignment: .leading, spacing: 2) {
              Text("Automations")
              Text("\((store.envelope?.automations ?? []).count) synced")
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
          } icon: {
            Image(systemName: "clock.arrow.circlepath")
          }
        }
      }
      .navigationTitle("PostHog Code")
      .refreshable {
        store.requestSnapshot()
      }
    }
  }
}

enum WatchInboxSortMode: String, CaseIterable {
  case priority
  case updated
  case strongest

  var label: String {
    switch self {
    case .priority: return "Priority"
    case .updated: return "Updated"
    case .strongest: return "Strongest"
    }
  }
}

enum WatchInboxStatusFilter: String, CaseIterable {
  case active
  case ready
  case needsInput
  case all

  var label: String {
    switch self {
    case .active: return "Active"
    case .ready: return "Ready"
    case .needsInput: return "Needs input"
    case .all: return "All"
    }
  }
}

func inboxStatusColor(_ status: String) -> Color {
  switch status {
  case "ready": return .green
  case "pending_input", "in_progress": return .orange
  case "candidate": return .blue
  case "failed": return .red
  default: return .secondary
  }
}

func priorityRank(_ priority: String?) -> Int {
  switch priority {
  case "P0": return 0
  case "P1": return 1
  case "P2": return 2
  case "P3": return 3
  case "P4": return 4
  default: return 9
  }
}

func sourceProductLabel(_ source: String) -> String {
  source
    .split(separator: "_")
    .map { $0.prefix(1).uppercased() + $0.dropFirst() }
    .joined(separator: " ")
}

struct InboxListView: View {
  @EnvironmentObject private var store: WatchTaskStore
  @AppStorage("watch_inbox_sort_mode") private var sortModeRaw = WatchInboxSortMode.priority.rawValue
  @AppStorage("watch_inbox_status_filter") private var statusFilterRaw = WatchInboxStatusFilter.active.rawValue
  @AppStorage("watch_inbox_source_filter") private var sourceFilter = "all"
  @AppStorage("watch_inbox_reviewer_filter") private var reviewerFilter = "all"

  private var sortMode: WatchInboxSortMode {
    WatchInboxSortMode(rawValue: sortModeRaw) ?? .priority
  }

  private var statusFilter: WatchInboxStatusFilter {
    WatchInboxStatusFilter(rawValue: statusFilterRaw) ?? .active
  }

  private var reports: [WatchInboxReportSnapshot] {
    (store.envelope?.inboxReports ?? [])
      .filter(matchesStatus)
      .filter { sourceFilter == "all" || $0.sourceProducts.contains(sourceFilter) }
      .filter { report in
        if reviewerFilter == "all" { return true }
        if reviewerFilter == "me" { return report.isSuggestedReviewer == true }
        return report.suggestedReviewerUuids.contains(reviewerFilter)
      }
      .sorted(by: sortReports)
  }

  var body: some View {
    if store.envelope?.isAuthenticated == false {
      SignedOutWatchView(state: store.connectionState)
    } else {
      List {
        NavigationLink { InboxFilterView() } label: {
          Label("Filter & Sort", systemImage: "line.3.horizontal.decrease.circle")
        }
        if reports.isEmpty {
          Text("No matching reports")
            .font(.caption)
            .foregroundStyle(.secondary)
        } else {
          ForEach(reports) { report in
            NavigationLink { InboxReportDetailView(report: report) } label: {
              InboxReportRow(report: report)
            }
          }
        }
      }
      .navigationTitle("Inbox")
      .refreshable {
        store.requestSnapshot()
      }
    }
  }

  private func matchesStatus(_ report: WatchInboxReportSnapshot) -> Bool {
    switch statusFilter {
    case .active:
      return ["ready", "pending_input", "in_progress", "failed", "candidate", "potential"].contains(report.status)
    case .ready:
      return report.status == "ready"
    case .needsInput:
      return report.status == "pending_input" || report.actionability == "requires_human_input"
    case .all:
      return true
    }
  }

  private func sortReports(_ lhs: WatchInboxReportSnapshot, _ rhs: WatchInboxReportSnapshot) -> Bool {
    if lhs.isSuggestedReviewer == true && rhs.isSuggestedReviewer != true { return true }
    if lhs.isSuggestedReviewer != true && rhs.isSuggestedReviewer == true { return false }
    switch sortMode {
    case .priority:
      let lhsRank = priorityRank(lhs.priority)
      let rhsRank = priorityRank(rhs.priority)
      if lhsRank != rhsRank { return lhsRank < rhsRank }
      return (lhs.updatedAt ?? 0) > (rhs.updatedAt ?? 0)
    case .updated:
      return (lhs.updatedAt ?? 0) > (rhs.updatedAt ?? 0)
    case .strongest:
      return lhs.totalWeight > rhs.totalWeight
    }
  }
}

struct InboxReportRow: View {
  let report: WatchInboxReportSnapshot

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      Circle()
        .fill(inboxStatusColor(report.status))
        .frame(width: 9, height: 9)
        .padding(.top, 4)
      VStack(alignment: .leading, spacing: 3) {
        HStack(alignment: .firstTextBaseline) {
          Text(report.title).font(.caption).lineLimit(2)
          Spacer(minLength: 4)
          Text(shortTime(report.updatedAt))
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
        }
        HStack(spacing: 4) {
          Text(report.statusText)
          if let priority = report.priority { Text(priority) }
          if let actionability = report.actionabilityText { Text(actionability) }
          if report.isSuggestedReviewer == true { Text("For you") }
        }
        .font(.system(size: 9))
        .foregroundStyle(.secondary)
        HStack(spacing: 4) {
          Image(systemName: "bolt.fill")
            .font(.system(size: 8))
          Text("\(report.signalCount)")
          if let firstSource = report.sourceProducts.first { Text(sourceProductLabel(firstSource)) }
        }
        .font(.system(size: 9))
        .foregroundStyle(.secondary)
      }
    }
  }
}

struct InboxFilterView: View {
  @EnvironmentObject private var store: WatchTaskStore
  @AppStorage("watch_inbox_sort_mode") private var sortModeRaw = WatchInboxSortMode.priority.rawValue
  @AppStorage("watch_inbox_status_filter") private var statusFilterRaw = WatchInboxStatusFilter.active.rawValue
  @AppStorage("watch_inbox_source_filter") private var sourceFilter = "all"
  @AppStorage("watch_inbox_reviewer_filter") private var reviewerFilter = "all"

  private var sources: [String] {
    Array(Set((store.envelope?.inboxReports ?? []).flatMap { $0.sourceProducts })).sorted()
  }

  var body: some View {
    Form {
      Picker("Sort by", selection: $sortModeRaw) {
        ForEach(WatchInboxSortMode.allCases, id: \.rawValue) { mode in
          Text(mode.label).tag(mode.rawValue)
        }
      }
      Picker("Status", selection: $statusFilterRaw) {
        ForEach(WatchInboxStatusFilter.allCases, id: \.rawValue) { filter in
          Text(filter.label).tag(filter.rawValue)
        }
      }
      Picker("Source", selection: $sourceFilter) {
        Text("All").tag("all")
        ForEach(sources, id: \.self) { source in
          Text(sourceProductLabel(source)).tag(source)
        }
      }
      Picker("Reviewer", selection: $reviewerFilter) {
        Text("All").tag("all")
        Text("Me").tag("me")
        ForEach(store.envelope?.inboxReviewers ?? []) { reviewer in
          Text(reviewer.isMe == true ? "\(reviewer.name) (Me)" : reviewer.name)
            .tag(reviewer.uuid)
        }
      }
    }
    .navigationTitle("Filter")
  }
}

struct InboxReportDetailView: View {
  @Environment(\.dismiss) private var dismiss
  @EnvironmentObject private var store: WatchTaskStore
  let report: WatchInboxReportSnapshot

  private var reportIds: String {
    (store.envelope?.inboxReports ?? [])
      .map(\.id)
      .sorted()
      .joined(separator: ",")
  }

  private var primaryActionTitle: String? {
    if report.allowedActions.contains("implement_as_task") { return "Implement as task" }
    if report.allowedActions.contains("start_task") { return "Start task" }
    return nil
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        VStack(alignment: .leading, spacing: 6) {
          HStack(spacing: 6) {
            Chip(text: report.statusText, color: inboxStatusColor(report.status))
            if let priority = report.priority { Chip(text: priority, color: .orange) }
            if report.isSuggestedReviewer == true { Chip(text: "For you", color: .orange) }
          }
          Text(report.title).font(.headline).lineLimit(3)
          HStack(spacing: 4) {
            Image(systemName: "bolt.fill")
              .font(.system(size: 10))
            Text("\(report.signalCount) signal\(report.signalCount == 1 ? "" : "s")")
            if let updatedAt = report.updatedAt { Text("· \(shortTime(updatedAt))") }
          }
          .font(.caption2)
          .foregroundStyle(.secondary)
        }

        if report.alreadyAddressed == true {
          Label("May already be addressed", systemImage: "exclamationmark.triangle.fill")
            .font(.caption)
            .foregroundStyle(.orange)
        }

        if let summary = report.summary, !summary.isEmpty {
          VStack(alignment: .leading, spacing: 4) {
            Text("Summary").font(.caption2).foregroundStyle(.secondary)
            Text(summary).font(.caption).lineLimit(10)
          }
          .padding(10)
          .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        }

        if !report.suggestedReviewers.isEmpty {
          VStack(alignment: .leading, spacing: 6) {
            Text("Suggested reviewers").font(.caption2).foregroundStyle(.secondary)
            ForEach(report.suggestedReviewers) { reviewer in
              HStack(spacing: 6) {
                Image(systemName: reviewer.isMe == true ? "eye.fill" : "person.crop.circle")
                  .foregroundStyle(reviewer.isMe == true ? .orange : .secondary)
                Text(reviewer.isMe == true ? "\(reviewer.name) (Me)" : reviewer.name)
                  .font(.caption)
                  .lineLimit(1)
              }
            }
          }
        }

        if !report.sourceProducts.isEmpty {
          HStack(spacing: 4) {
            ForEach(report.sourceProducts.prefix(3), id: \.self) { source in
              Chip(text: sourceProductLabel(source))
            }
          }
        }

        VStack(spacing: 6) {
          if let primaryActionTitle {
            Button(primaryActionTitle) {
              send(type: "start_report_task")
              dismiss()
            }
            .buttonStyle(.borderedProminent)
            .tint(accent)
          }
          if report.allowedActions.contains("dismiss") {
            Button("Dismiss") {
              sendDismiss()
              dismiss()
            }
            .tint(.red)
          }
          Button("Open on iPhone") { send(type: "open_report") }
          if let status = store.lastCommandStatus {
            Text(status).font(.caption2).foregroundStyle(.secondary)
          }
        }
      }
      .padding(.vertical, 4)
    }
    .navigationTitle("Report")
    .onChange(of: reportIds) { ids in
      if !ids.split(separator: ",").contains(Substring(report.id)) {
        dismiss()
      }
    }
  }

  private func send(type: String) {
    store.send(command: WatchTaskCommand(
      id: UUID().uuidString,
      type: type,
      taskId: report.id,
      url: report.handoff.phoneUrl,
      reportId: report.id
    ))
  }

  private func sendDismiss() {
    store.send(command: WatchTaskCommand(
      id: UUID().uuidString,
      type: "dismiss_report",
      taskId: report.id,
      optionId: "other",
      displayText: "Dismiss report",
      url: report.handoff.phoneUrl,
      reportId: report.id
    ))
  }
}

func automationStatusColor(_ automation: WatchAutomationSnapshot) -> Color {
  if automation.statusText == "Running" || automation.statusText == "Queued" { return .blue }
  if automation.statusText == "Failed" { return .red }
  if automation.statusText == "Success" { return .green }
  return automation.enabled ? .orange : .secondary
}

struct AutomationsListView: View {
  @EnvironmentObject private var store: WatchTaskStore

  private var automations: [WatchAutomationSnapshot] {
    (store.envelope?.automations ?? [])
      .sorted { ($0.updatedAt ?? 0) > ($1.updatedAt ?? 0) }
  }

  var body: some View {
    List {
      Button { send(type: "new_automation", automationId: "new") } label: {
        Label("New Automation", systemImage: "plus")
      }
      .tint(accent)

      if automations.isEmpty {
        Text("No automations yet")
          .font(.caption)
          .foregroundStyle(.secondary)
      } else {
        ForEach(automations) { automation in
          NavigationLink { AutomationDetailView(automation: automation) } label: {
            AutomationRow(automation: automation)
          }
        }
      }
    }
    .navigationTitle("Automations")
    .toolbar {
      Button { store.requestSnapshot() } label: {
        Image(systemName: "arrow.clockwise")
          .font(.system(size: 12, weight: .semibold))
      }
      .buttonStyle(.plain)
      .foregroundStyle(accent)
      .accessibilityLabel("Refresh Automations")
    }
  }

  private func send(type: String, automationId: String) {
    store.send(command: WatchTaskCommand(
      id: UUID().uuidString,
      type: type,
      taskId: automationId,
      automationId: automationId
    ))
  }
}

struct AutomationRow: View {
  let automation: WatchAutomationSnapshot

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      Circle()
        .fill(automationStatusColor(automation))
        .frame(width: 9, height: 9)
        .padding(.top, 4)
      VStack(alignment: .leading, spacing: 3) {
        HStack(alignment: .firstTextBaseline) {
          Text(automation.name).font(.caption).lineLimit(1)
          Spacer(minLength: 4)
          Text(shortTime(automation.lastRunAt))
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
        }
        HStack(spacing: 4) {
          Text(automation.enabled ? "Enabled" : "Paused")
          Text(automation.statusText)
        }
        .font(.system(size: 9))
        .foregroundStyle(.secondary)
        Text(automation.secondaryLabel)
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
          .lineLimit(1)
        Text(automation.scheduleSummary)
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
    }
  }
}

struct AutomationDetailView: View {
  @Environment(\.dismiss) private var dismiss
  @EnvironmentObject private var store: WatchTaskStore
  let automation: WatchAutomationSnapshot

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        VStack(alignment: .leading, spacing: 6) {
          HStack(spacing: 6) {
            Chip(text: automation.enabled ? "Enabled" : "Paused", color: automation.enabled ? .orange : .secondary)
            Chip(text: automation.statusText, color: automationStatusColor(automation))
          }
          Text(automation.name).font(.headline).lineLimit(3)
          Text(automation.scheduleSummary)
            .font(.caption2)
            .foregroundStyle(.secondary)
        }

        VStack(alignment: .leading, spacing: 4) {
          Text(automation.repository?.isEmpty == false ? "Repository" : "Context")
            .font(.caption2)
            .foregroundStyle(.secondary)
          Text(automation.secondaryLabel)
            .font(.caption)
            .lineLimit(3)
        }
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))

        VStack(alignment: .leading, spacing: 4) {
          Text("Prompt").font(.caption2).foregroundStyle(.secondary)
          Text(automation.prompt).font(.caption).lineLimit(8)
        }
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))

        if let lastTaskId = automation.lastTaskId, !lastTaskId.isEmpty {
          VStack(alignment: .leading, spacing: 4) {
            Text("Last task").font(.caption2).foregroundStyle(.secondary)
            Text(lastTaskId).font(.caption).lineLimit(1)
          }
        }

        if let lastError = automation.lastError, !lastError.isEmpty {
          Label(lastError, systemImage: "xmark.octagon.fill")
            .font(.caption)
            .foregroundStyle(.red)
            .lineLimit(4)
        }

        VStack(spacing: 6) {
          Button("Run now") { sendAndDismiss(type: "run_automation") }
            .buttonStyle(.borderedProminent)
            .tint(accent)
          if automation.allowedActions.contains("pause") {
            Button("Pause") { sendAndDismiss(type: "pause_automation") }
              .tint(.orange)
          }
          if automation.allowedActions.contains("resume") {
            Button("Resume") { sendAndDismiss(type: "resume_automation") }
              .tint(accent)
          }
          Button("Open on iPhone") { send(type: "open_automation") }
          if let status = store.lastCommandStatus {
            Text(status).font(.caption2).foregroundStyle(.secondary)
          }
        }
      }
      .padding(.vertical, 4)
    }
    .navigationTitle("Automation")
  }

  private func send(type: String) {
    store.send(command: WatchTaskCommand(
      id: UUID().uuidString,
      type: type,
      taskId: automation.id,
      url: automation.handoff.phoneUrl,
      automationId: automation.id
    ))
  }

  private func sendAndDismiss(type: String) {
    send(type: type)
    dismiss()
  }
}
