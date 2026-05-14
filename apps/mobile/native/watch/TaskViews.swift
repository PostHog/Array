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
        .navigationDestination(for: String.self) { id in
          if let task = store.tasks.first(where: { $0.id == id }) {
            TaskOverviewView(task: task)
          }
        }
      }
    }
  }

  private func taskSortTimestamp(_ task: WatchTaskSnapshot) -> TimeInterval {
    if sortMode == .created { return task.createdAt ?? task.generatedAt }
    return task.updatedAt ?? task.generatedAt
  }

  private func taskLink(_ task: WatchTaskSnapshot) -> some View {
    NavigationLink(value: task.id) {
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

func presentNewTaskInput(_ completion: @escaping (String) -> Void) {
  let suggestions = [
    "Create or update my CLAUDE.md file",
    "Search for a TODO comment and fix it",
    "Recommend areas to improve our tests",
  ]
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
  let task: WatchTaskSnapshot

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        TaskHeader(task: task)
        if let approval = task.approval { ApprovalCard(task: task, approval: approval) }
        if let blocker = task.blocker, task.approval == nil { BlockerCard(task: task, blocker: blocker) }
        CurrentTaskCard(task: task)
        NavigationLink { ChecklistView(task: task) } label: { Label("Checklist", systemImage: "checklist") }
        NavigationLink { TimelineView(task: task) } label: { Label("Timeline", systemImage: "point.3.connected.trianglepath.dotted") }
        HandoffButtons(task: task)
        if let status = store.lastCommandStatus {
          Text(status).font(.caption2).foregroundStyle(.secondary)
        }
        if let envelopeStatus = store.lastEnvelopeStatus {
          Text(envelopeStatus).font(.caption2).foregroundStyle(.secondary)
        }
      }
      .padding(.vertical, 4)
    }
    .navigationTitle("Task")
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
