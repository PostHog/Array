import Foundation
import SwiftUI
import WatchConnectivity

@MainActor
final class WatchMissionStore: NSObject, ObservableObject {
    @Published var envelope: WatchMissionEnvelope?
    @Published var connectionState: String = "Waiting for iPhone"
    @Published var lastCommandStatus: String?

    let haptics = HapticsPolicy()
    private let cacheKey = "watch_mission_envelope"

    var missions: [WatchMissionSnapshot] { envelope?.missions ?? [] }

    var activeMission: WatchMissionSnapshot? {
        guard let envelope else { return missions.first }
        if let activeId = envelope.activeMissionId {
            return envelope.missions.first { $0.id == activeId } ?? envelope.missions.first
        }
        return envelope.missions.first
    }

    override init() {
        super.init()
        loadCachedEnvelope()
        activateSession()
    }

    func send(command: WatchMissionCommand) {
        lastCommandStatus = "Sending…"
        guard WCSession.isSupported() else {
            lastCommandStatus = "iPhone relay unavailable"
            return
        }

        let payload = encodeDictionary(command)
        let message: [String: Any] = ["type": "mission_command", "payload": payload]
        let session = WCSession.default

        if session.isReachable {
            session.sendMessage(message, replyHandler: { [weak self] reply in
                Task { @MainActor in
                    self?.haptics.actionAccepted()
                    self?.lastCommandStatus = (reply["ok"] as? Bool) == true ? "Sent" : "Failed"
                }
            }, errorHandler: { [weak self] _ in
                Task { @MainActor in
                    self?.lastCommandStatus = "Failed"
                }
            })
        } else {
            do {
                try session.updateApplicationContext(message)
                haptics.actionAccepted()
                lastCommandStatus = "Queued for iPhone"
            } catch {
                lastCommandStatus = "Failed"
            }
        }
    }

    private func activateSession() {
        guard WCSession.isSupported() else {
            connectionState = "WatchConnectivity unavailable"
            return
        }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    private func handleEnvelopePayload(_ payload: Any?) {
        guard let payload else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: payload)
            let envelope = try JSONDecoder().decode(WatchMissionEnvelope.self, from: data)
            self.envelope = envelope
            self.connectionState = "Live"
            if let activeId = envelope.activeMissionId,
               let active = envelope.missions.first(where: { $0.id == activeId }) {
                haptics.apply(snapshot: active)
            } else if let first = envelope.missions.first {
                haptics.apply(snapshot: first)
            }
            cache(data: data)
        } catch {
            connectionState = "Snapshot decode failed"
        }
    }

    private func encodeDictionary<T: Encodable>(_ value: T) -> [String: Any] {
        guard
            let data = try? JSONEncoder().encode(value),
            let object = try? JSONSerialization.jsonObject(with: data),
            let dictionary = object as? [String: Any]
        else { return [:] }
        return dictionary
    }

    private func cache(data: Data) {
        UserDefaults.standard.set(data, forKey: cacheKey)
    }

    private func loadCachedEnvelope() {
        guard let data = UserDefaults.standard.data(forKey: cacheKey) else { return }
        envelope = try? JSONDecoder().decode(WatchMissionEnvelope.self, from: data)
        if envelope != nil { connectionState = "Cached" }
    }
}

extension WatchMissionStore: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        Task { @MainActor in
            self.connectionState = activationState == .activated ? "Connected" : "Disconnected"
            if let payload = session.receivedApplicationContext["payload"] {
                self.handleEnvelopePayload(payload)
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in
            guard applicationContext["type"] as? String == "mission_envelope" else { return }
            self.handleEnvelopePayload(applicationContext["payload"])
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor in
            guard message["type"] as? String == "mission_envelope" else { return }
            self.handleEnvelopePayload(message["payload"])
        }
    }
}
