import Foundation

struct WatchTaskEnvelope: Codable {
    let schemaVersion: Int
    let generatedAt: TimeInterval
    let isAuthenticated: Bool?
    let activeTaskId: String?
    let tasks: [WatchTaskSnapshot]
    let inboxReports: [WatchInboxReportSnapshot]?
    let inboxReviewers: [WatchInboxReviewer]?

    enum CodingKeys: String, CodingKey {
        case schemaVersion
        case generatedAt
        case isAuthenticated
        case activeTaskId = "activeTaskId"
        case tasks = "tasks"
        case inboxReports = "inboxReports"
        case inboxReviewers = "inboxReviewers"
    }
}

struct WatchInboxReviewer: Codable, Identifiable {
    var id: String { uuid }
    let uuid: String
    let name: String
    let email: String?
    let githubLogin: String?
    let isMe: Bool?
}

struct WatchInboxSuggestedReviewer: Codable, Identifiable {
    var id: String { uuid ?? githubLogin }
    let uuid: String?
    let name: String
    let githubLogin: String
    let isMe: Bool?
}

struct WatchInboxReportSnapshot: Codable, Identifiable {
    let schemaVersion: Int
    let id: String
    let title: String
    let summary: String?
    let status: String
    let statusText: String
    let priority: String?
    let actionability: String?
    let actionabilityText: String?
    let alreadyAddressed: Bool?
    let isSuggestedReviewer: Bool?
    let suggestedReviewerUuids: [String]
    let suggestedReviewers: [WatchInboxSuggestedReviewer]
    let sourceProducts: [String]
    let signalCount: Int
    let totalWeight: Double
    let createdAt: TimeInterval?
    let updatedAt: TimeInterval?
    let implementationPrUrl: String?
    let repository: String?
    let allowedActions: [String]
    let handoff: WatchTaskHandoff
}

struct WatchTaskSnapshot: Codable, Identifiable {
    let schemaVersion: Int
    let id: String
    let generatedAt: TimeInterval
    let source: String
    let taskId: String
    let taskRunId: String?
    let taskNumber: Int?
    let slug: String?
    let title: String
    let subtitle: String?
    let repository: String?
    let branch: String?
    let `internal`: Bool?
    let isArchived: Bool?
    let environment: String
    let status: String
    let statusText: String
    let currentTask: String?
    let createdAt: TimeInterval?
    let startedAt: TimeInterval?
    let updatedAt: TimeInterval?
    let completedAt: TimeInterval?
    let elapsedSeconds: Int
    let progress: WatchTaskProgress
    let checklist: [WatchTaskChecklistItem]
    let timeline: [WatchTaskTimelineItem]
    let approval: WatchTaskApproval?
    let blocker: WatchTaskBlocker?
    let lastError: String?
    let isStale: Bool
    let staleReason: String?
    let allowedActions: [String]
    let handoff: WatchTaskHandoff
}

struct WatchTaskProgress: Codable {
    let completed: Int
    let running: Int
    let pending: Int
    let failed: Int
    let total: Int
    let fraction: Double
}

struct WatchTaskChecklistItem: Codable, Identifiable {
    let id: String
    let title: String
    let subtitle: String?
    let status: String
    let priority: String?
    let depth: Int?
    let kind: String?
    let updatedAt: TimeInterval?
}

struct WatchTaskTimelineItem: Codable, Identifiable {
    let id: String
    let title: String
    let detail: String?
    let kind: String
    let timestamp: TimeInterval
}

struct WatchTaskApproval: Codable, Identifiable {
    let id: String
    let toolCallId: String
    let title: String
    let summary: String
    let detail: String?
    let risk: String
    let requestedAt: TimeInterval
    let options: [WatchTaskApprovalOption]
    let diffAvailable: Bool?
}

struct WatchTaskApprovalOption: Codable, Identifiable {
    let id: String
    let title: String
    let role: String
    let destructive: Bool?
}

struct WatchTaskBlocker: Codable {
    let title: String
    let detail: String?
    let kind: String
}

struct WatchTaskHandoff: Codable {
    let phoneUrl: String
    let macUrl: String?
    let webUrl: String?
}

struct WatchTaskCommand: Codable {
    let id: String
    let type: String
    let taskId: String
    let taskRunId: String?
    let toolCallId: String?
    let optionId: String?
    let displayText: String?
    let answers: [String: String]?
    let customInput: String?
    let url: String?
    let reportId: String?
    let dismissalReason: String?

    init(
        id: String,
        type: String,
        taskId: String,
        taskRunId: String? = nil,
        toolCallId: String? = nil,
        optionId: String? = nil,
        displayText: String? = nil,
        answers: [String: String]? = nil,
        customInput: String? = nil,
        url: String? = nil,
        reportId: String? = nil,
        dismissalReason: String? = nil
    ) {
        self.id = id
        self.type = type
        self.taskId = taskId
        self.taskRunId = taskRunId
        self.toolCallId = toolCallId
        self.optionId = optionId
        self.displayText = displayText
        self.answers = answers
        self.customInput = customInput
        self.url = url
        self.reportId = reportId
        self.dismissalReason = dismissalReason
    }
}
