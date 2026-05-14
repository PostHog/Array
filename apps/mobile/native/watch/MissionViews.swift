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

struct MissionRootView: View {
    @EnvironmentObject private var store: WatchMissionStore

    var body: some View {
        NavigationStack {
            if store.missions.isEmpty {
                EmptyMissionView(state: store.connectionState)
            } else if store.missions.count == 1, let mission = store.activeMission {
                MissionOverviewView(mission: mission)
            } else {
                List(store.missions) { mission in
                    NavigationLink(value: mission.id) { MissionRow(mission: mission) }
                }
                .navigationTitle("Missions")
                .navigationDestination(for: String.self) { id in
                    if let mission = store.missions.first(where: { $0.id == id }) {
                        MissionOverviewView(mission: mission)
                    }
                }
            }
        }
    }
}

struct EmptyMissionView: View {
    @EnvironmentObject private var store: WatchMissionStore
    let state: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "antenna.radiowaves.left.and.right")
                .font(.title2)
                .foregroundStyle(accent)
            Text("Mission Control").font(.headline)
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

struct MissionRow: View {
    let mission: WatchMissionSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(mission.slug ?? "CODE").font(.caption2).foregroundStyle(.secondary)
                Spacer()
                Circle().fill(statusColor(mission.status)).frame(width: 7, height: 7)
            }
            Text(mission.title).font(.caption).lineLimit(2)
            ProgressView(value: mission.progress.fraction).tint(statusColor(mission.status))
        }
    }
}

struct MissionOverviewView: View {
    @EnvironmentObject private var store: WatchMissionStore
    let mission: WatchMissionSnapshot

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                MissionHeader(mission: mission)
                if let approval = mission.approval { ApprovalCard(mission: mission, approval: approval) }
                if let blocker = mission.blocker, mission.approval == nil { BlockerCard(mission: mission, blocker: blocker) }
                CurrentTaskCard(mission: mission)
                NavigationLink { ChecklistView(mission: mission) } label: { Label("Checklist", systemImage: "checklist") }
                NavigationLink { TimelineView(mission: mission) } label: { Label("Timeline", systemImage: "point.3.connected.trianglepath.dotted") }
                HandoffButtons(mission: mission)
                if let status = store.lastCommandStatus {
                    Text(status).font(.caption2).foregroundStyle(.secondary)
                }
                if let envelopeStatus = store.lastEnvelopeStatus {
                    Text(envelopeStatus).font(.caption2).foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)
        }
        .navigationTitle("Mission")
    }
}

struct MissionHeader: View {
    let mission: WatchMissionSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                ZStack {
                    ProgressView(value: mission.progress.fraction)
                        .progressViewStyle(.circular)
                        .tint(statusColor(mission.status))
                    Text("\(Int(mission.progress.fraction * 100))")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(mission.title).font(.headline).lineLimit(2)
                    Text(mission.statusText).font(.caption).foregroundStyle(statusColor(mission.status))
                }
            }
            HStack(spacing: 6) {
                Chip(text: mission.environment == "local" ? "Local" : mission.environment.capitalized)
                Chip(text: formatElapsed(mission.elapsedSeconds))
                if mission.isStale { Chip(text: "Stale", color: .orange) }
            }
            Text("\(mission.progress.completed)/\(mission.progress.total) done")
                .font(.caption2)
                .foregroundStyle(.secondary)
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
    let mission: WatchMissionSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Current").font(.caption2).foregroundStyle(.secondary)
            Text(mission.currentTask ?? "Waiting for next step").font(.caption).lineLimit(3)
        }
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct ChecklistView: View {
    let mission: WatchMissionSnapshot

    var body: some View {
        List(mission.checklist) { item in
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
    let mission: WatchMissionSnapshot

    var body: some View {
        List(mission.timeline) { item in
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
    let mission: WatchMissionSnapshot
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
                Button("View Diff") { send(type: "view_diff", url: mission.handoff.phoneUrl) }
            }
        }
        .padding(10)
        .background(.orange.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
    }

    private func sendApproval(_ option: WatchMissionApprovalOption) {
        store.send(command: WatchMissionCommand(
            id: UUID().uuidString,
            type: "approval_response",
            taskId: mission.taskId,
            taskRunId: mission.taskRunId,
            toolCallId: approval.toolCallId,
            optionId: option.id,
            displayText: option.title,
            answers: nil,
            customInput: nil,
            url: nil
        ))
    }

    private func send(type: String, url: String?) {
        store.send(command: WatchMissionCommand(id: UUID().uuidString, type: type, taskId: mission.taskId, taskRunId: mission.taskRunId, toolCallId: nil, optionId: nil, displayText: nil, answers: nil, customInput: nil, url: url))
    }
}

struct BlockerCard: View {
    @EnvironmentObject private var store: WatchMissionStore
    let mission: WatchMissionSnapshot
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
        store.send(command: WatchMissionCommand(id: UUID().uuidString, type: type, taskId: mission.taskId, taskRunId: mission.taskRunId, toolCallId: nil, optionId: nil, displayText: nil, answers: nil, customInput: nil, url: nil))
    }
}

struct HandoffButtons: View {
    @EnvironmentObject private var store: WatchMissionStore
    let mission: WatchMissionSnapshot

    var body: some View {
        VStack(spacing: 6) {
            Button("Open on iPhone") { send(type: "open_phone", url: mission.handoff.phoneUrl) }
            Button("Send Demo Prompt") { sendDemoPrompt() }
            if mission.handoff.macUrl != nil { Button("Open on Mac") { send(type: "open_mac", url: mission.handoff.macUrl) } }
            if mission.allowedActions.contains("stop") { Button("Stop Agent") { send(type: "stop", url: nil) }.tint(.red) }
        }
    }

    private func send(type: String, url: String?) {
        store.send(command: WatchMissionCommand(id: UUID().uuidString, type: type, taskId: mission.taskId, taskRunId: mission.taskRunId, toolCallId: nil, optionId: nil, displayText: nil, answers: nil, customInput: nil, url: url))
    }

    private func sendDemoPrompt() {
        store.send(command: WatchMissionCommand(id: UUID().uuidString, type: "send_prompt", taskId: mission.taskId, taskRunId: mission.taskRunId, toolCallId: nil, optionId: nil, displayText: "Demo prompt from Apple Watch", answers: nil, customInput: nil, url: nil))
    }
}
