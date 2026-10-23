import type { MockModule } from "@/core/mock"
import { MockFailure } from "@/core/mock"
import type { Options } from "./api"

let content =
  "MODEL=Pixel 9 Pro\nFINGERPRINT=google/caiman/caiman:16/ID/123:user/release-keys\nSECURITY_PATCH=2026-10-05\nspoofProvider=0\n"
let revision = "initial"
let previous = ""
let count = 0
let cancelled = false
let stopRevision = "initial"
let interrupted = new URLSearchParams(location.search).get("interrupted-transaction") === "1"
const options: Options = {
  enabled: true,
  mode: "full",
  skipdelprop: false,
  skippersistprop: false,
  skipmatchdevice: false,
}
const entries = (value: string) =>
  Object.fromEntries(
    value
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=")
        return [line.slice(0, at), line.slice(at + 1)]
      }),
  )
const config = () => ({
  content,
  json: JSON.stringify(entries(content)),
  entries: entries(content),
  revision,
})
function preview(value: string) {
  const next = value.trim().startsWith("{")
    ? (JSON.parse(value) as Record<string, string>)
    : entries(value)
  const before = entries(content)
  return {
    content: Object.entries(next)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
    json: JSON.stringify(next),
    entries: next,
    revision,
    changes: [...new Set([...Object.keys(before), ...Object.keys(next)])]
      .filter((key) => before[key] !== next[key])
      .map((key) => ({ key, before: before[key] ?? null, after: next[key] ?? null })),
    suggested_patch: next.SECURITY_PATCH ?? null,
  }
}
const mock: MockModule = {
  feature: { id: "play-integrity", contract: 1 },
  handlers: {
    "play-integrity.power": () => ({
      enabled: options.enabled,
      disabled_by_marker: !options.enabled,
      stop_revision: stopRevision,
      cleanup_pending: false,
      issues: [],
    }),
    "play-integrity.disable": () => {
      options.enabled = false
      cancelled = true
      stopRevision = String(Date.now())
      return {
        enabled: false,
        disabled_by_marker: true,
        stop_revision: stopRevision,
        cleanup_pending: false,
        issues: [],
        reboot_required: true,
        process_restart_required: true,
      }
    },
    "integrity-transaction.status": () => ({
      pending: interrupted,
      journal_path: "/data/adb/duck-toolbox/var/integrity-transaction/journal.json",
      journal: null,
    }),
    "integrity-transaction.recover": () => {
      interrupted = false
      return { restored: true, restart_required: true }
    },
    "integrity-transaction.apply": (args, flags, input) => {
      if (interrupted)
        throw new MockFailure("internal_error", "Interrupted transaction requires recovery")
      const request = input as { engine: unknown; patch?: unknown }
      const result = mock.handlers["play-integrity.apply"]!(args, flags, request.engine)
      if (request.patch && new URLSearchParams(location.search).get("patch-fail") === "1") {
        mock.handlers["play-integrity.restore"]!(args, flags, {})
        throw new MockFailure("backend_rule", "Patch fixture rejected")
      }
      return result
    },
    "play-integrity.status": () => {
      if (new URLSearchParams(location.search).has("invalid-pif"))
        throw new MockFailure("engine_error", "Invalid configuration fixture")
      return {
        upstream_revision: "23ec56c2440c4fd1a5e893a23ef7861d6366a828",
        options: { ...options },
        has_config: true,
        zygisk_detected: true,
        conflicts: [],
        reboot_required: false,
        state: options.enabled
          ? options.mode === "scripts-only"
            ? "scripts-only"
            : "configured"
          : "disabled",
        data_dir: "/data/adb/play-integrity",
        verdict_verified: false,
        app_replace_list: "# ROM conflict paths\n",
      }
    },
    "play-integrity.config": config,
    "play-integrity.preview": (_args, _flags, input) =>
      preview(String((input as { content: string }).content)),
    "play-integrity.import-preview": () =>
      preview("MODEL=Imported\nSECURITY_PATCH=2026-10-05\nEXTRA=preserved\n"),
    "play-integrity.apply": (_args, _flags, input) => {
      const request = input as { content: string; revision: string }
      if (request.revision !== revision)
        throw new MockFailure("engine_error", "Configuration changed; preview again")
      previous = content
      content = preview(request.content).content
      revision = String(Date.now())
      return { config: config(), backup: "mock-backup", restart_required: true }
    },
    "play-integrity.restore": () => {
      content = previous
      revision = String(Date.now())
      return { config: config(), restart_required: true }
    },
    "play-integrity.options": (_args, _flags, input) => {
      Object.assign(options, input)
      return { options: { ...options }, reboot_required: true }
    },
    "play-integrity.task-start": () => {
      count = 0
      cancelled = false
      return { id: "fixture-task", state: "running", result: null, error: null, output: "" }
    },
    "play-integrity.task-status": () => ({
      id: "fixture-task",
      state: cancelled ? "cancelled" : ++count < 2 ? "running" : "completed",
      result:
        cancelled || count < 2
          ? null
          : {
              ...preview("MODEL=Pixel Canary\nSECURITY_PATCH=2026-10-05\nspoofProvider=0\n"),
              metadata: { released: "2026-10-01", estimated_expiry: "2026-11-12" },
            },
      error: null,
      output: "Pixel Canary metadata fetched over HTTPS",
    }),
    "play-integrity.task-cancel": () => {
      cancelled = true
      return { id: "fixture-task", state: "cancelled", result: null, error: null, output: "" }
    },
    "play-integrity.restart": () => ({
      processes: [
        { process: "com.google.android.gms.unstable", exit_code: 0, output: "" },
        { process: "com.android.vending", exit_code: 0, output: "" },
      ],
      verdict_verified: false,
    }),
    "play-integrity.diagnose": () => ({
      log: "PIF/Native: Injection initialized for com.google.android.gms.unstable",
      verdict_verified: false,
    }),
  },
}
export default mock
