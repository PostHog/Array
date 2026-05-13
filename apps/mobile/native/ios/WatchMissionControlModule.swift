import Foundation
import React
import WatchConnectivity

@objc(WatchMissionControlModule)
final class WatchMissionControlModule: RCTEventEmitter, WCSessionDelegate {
  private var hasListeners = false
  private var latestEnvelope: [String: Any]?

  override init() {
    super.init()
    activateSessionIfAvailable()
  }

  override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return ["WatchMissionControlCommand"]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  @objc
  func isSupported(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(WCSession.isSupported())
  }

  @objc
  func publishEnvelope(
    _ envelope: NSDictionary,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    guard WCSession.isSupported() else {
      resolve(false)
      return
    }

    let payload = sanitizeDictionary(envelope)
    latestEnvelope = payload
    let session = WCSession.default
    activateSessionIfAvailable()

    do {
      try session.updateApplicationContext(["type": "mission_envelope", "payload": payload])
      resolve(true)
    } catch {
      reject("watch_context_failed", "Failed to update watch application context", error)
    }
  }

  @objc
  func sendUrgentUpdate(
    _ envelope: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard WCSession.isSupported() else {
      resolve(false)
      return
    }

    let payload = sanitizeDictionary(envelope)
    latestEnvelope = payload
    activateSessionIfAvailable()

    let message: [String: Any] = ["type": "mission_envelope", "payload": payload]
    if WCSession.default.isReachable {
      WCSession.default.sendMessage(message, replyHandler: { _ in
        resolve(true)
      }, errorHandler: { error in
        reject("watch_message_failed", "Failed to send urgent watch update", error)
      })
    } else {
      do {
        try WCSession.default.updateApplicationContext(message)
        resolve(true)
      } catch {
        reject("watch_context_failed", "Failed to update watch application context", error)
      }
    }
  }

  private func activateSessionIfAvailable() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    if session.activationState == .notActivated {
      session.activate()
    }
  }

  private func emitCommand(_ command: [String: Any]) {
    guard hasListeners else { return }
    DispatchQueue.main.async { [weak self] in
      self?.sendEvent(withName: "WatchMissionControlCommand", body: command)
    }
  }

  private func sanitizeDictionary(_ dictionary: NSDictionary) -> [String: Any] {
    var result: [String: Any] = [:]
    for (key, value) in dictionary {
      guard let key = key as? String else { continue }
      result[key] = sanitizeValue(value)
    }
    return result
  }

  private func sanitizeArray(_ array: NSArray) -> [Any] {
    array.map { sanitizeValue($0) }
  }

  private func sanitizeValue(_ value: Any) -> Any {
    if let dictionary = value as? NSDictionary {
      return sanitizeDictionary(dictionary)
    }
    if let array = value as? NSArray {
      return sanitizeArray(array)
    }
    if value is NSNull {
      return NSNull()
    }
    return value
  }

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    if activationState == .activated, let latestEnvelope {
      try? session.updateApplicationContext(["type": "mission_envelope", "payload": latestEnvelope])
    }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    handleMessage(message, replyHandler: nil)
  }

  func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    handleMessage(message, replyHandler: replyHandler)
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    handleMessage(applicationContext, replyHandler: nil)
  }

  private func handleMessage(_ message: [String: Any], replyHandler: (([String: Any]) -> Void)?) {
    guard let type = message["type"] as? String else {
      replyHandler?(["ok": false, "error": "missing_type"])
      return
    }

    if type == "mission_command" {
      if let command = message["payload"] as? [String: Any] {
        emitCommand(command)
        replyHandler?(["ok": true])
      } else {
        replyHandler?(["ok": false, "error": "missing_payload"])
      }
      return
    }

    replyHandler?(["ok": false, "error": "unknown_type"])
  }
}
