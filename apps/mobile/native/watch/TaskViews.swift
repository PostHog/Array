import SwiftUI

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
    case "running", "connecting": return .blue
    default: return .secondary
    }
}

struct TasksRootView: View {
    @EnvironmentObject private var store: WatchMissionStore

    var body: some View {
        NavigationStack {
            if store.tasks.isEmpty {
                EmptyTasksView(state: store.connectionState)
            } else {
                List(store.tasks) { task in
                    NavigationLink(value: task.id) {
                        TaskRow(task: task)
                    }
                    .listRowBackground(
                        ActiveTaskRowBackground(
                            isActive: store.envelope?.activeTaskId == task.id
                        )
                    )
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
}

struct EmptyTasksView: View {
    @EnvironmentObject private var store: WatchMissionStore
    let state: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "antenna.radiowaves.left.and.right")
                .font(.title2)
                .foregroundStyle(accent)
            Text("Tasks").font(.headline)
            Text(state).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if let envelopeStatus = store.lastEnvelopeStatus {
                Text(envelopeStatus).font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            Text("Start or open a PostHog Code task on iPhone or Mac.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Ping iPhone") { sendPing() }
                .buttonStyle(.borderedProminent)
            Button("Request Snapshot") { requestSnapshot() }
            if let status = store.lastCommandStatus {
                Text(status).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding()
    }

    private func sendPing() {
        store.send(command: WatchMissionCommand(id: UUID().uuidString, type: "debug_ping", taskId: "debug", taskRunId: nil, toolCallId: nil, optionId: nil, displayText: "Ping from Apple Watch", answers: nil, customInput: nil, url: nil))
    }

    private func requestSnapshot() {
        store.send(command: WatchMissionCommand(id: UUID().uuidString, type: "debug_request_snapshot", taskId: "debug", taskRunId: nil, toolCallId: nil, optionId: nil, displayText: "Request snapshot from Apple Watch", answers: nil, customInput: nil, url: nil))
    }
}

struct TaskRow: View {
    let task: WatchTaskSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(task.slug ?? "CODE").font(.caption2).foregroundStyle(.secondary)
                Spacer()
                Circle().fill(statusColor(task.status)).frame(width: 7, height: 7)
            }
            Text(task.title).font(.caption).lineLimit(2)
            if task.progress.total > 0 {
                ProgressView(value: task.progress.fraction).tint(statusColor(task.status))
            }
        }
    }
}

struct ActiveTaskRowBackground: View {
    let isActive: Bool

    var body: some View {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(Color.secondary.opacity(0.16))
            .overlay(alignment: .leading) {
                if isActive {
                    Rectangle()
                        .fill(Color.orange)
                        .frame(width: 4)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct TaskOverviewView: View {
    @EnvironmentObject private var store: WatchMissionStore
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
    @EnvironmentObject private var store: WatchMissionStore
    let task: WatchTaskSnapshot
    let approval: WatchMissionApproval

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

    private func sendApproval(_ option: WatchMissionApprovalOption) {
        store.send(command: WatchMissionCommand(
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
        store.send(command: WatchMissionCommand(id: UUID().uuidString, type: type, taskId: task.taskId, taskRunId: task.taskRunId, toolCallId: nil, optionId: nil, displayText: nil, answers: nil, customInput: nil, url: url))
    }
}

struct BlockerCard: View {
    @EnvironmentObject private var store: WatchMissionStore
    let task: WatchTaskSnapshot
    let blocker: WatchMissionBlocker

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
        store.send(command: WatchMissionCommand(id: UUID().uuidString, type: type, taskId: task.taskId, taskRunId: task.taskRunId, toolCallId: nil, optionId: nil, displayText: nil, answers: nil, customInput: nil, url: nil))
    }
}

struct HandoffButtons: View {
    @EnvironmentObject private var store: WatchMissionStore
    let task: WatchTaskSnapshot

    var body: some View {
        VStack(spacing: 6) {
            Button("Open on iPhone") { send(type: "open_phone", url: task.handoff.phoneUrl) }
            Button("Send Demo Prompt") { sendDemoPrompt() }
            if task.allowedActions.contains("stop") { Button("Stop Agent") { send(type: "stop", url: nil) }.tint(.red) }
        }
    }

    private func send(type: String, url: String?) {
        store.send(command: WatchMissionCommand(id: UUID().uuidString, type: type, taskId: task.taskId, taskRunId: task.taskRunId, toolCallId: nil, optionId: nil, displayText: nil, answers: nil, customInput: nil, url: url))
    }

    private func sendDemoPrompt() {
        store.send(command: WatchMissionCommand(id: UUID().uuidString, type: "send_prompt", taskId: task.taskId, taskRunId: task.taskRunId, toolCallId: nil, optionId: nil, displayText: "Demo prompt from Apple Watch", answers: nil, customInput: nil, url: nil))
    }
}
