import { afterEach, describe, expect, it, vi } from "vitest"

import { createKernelSuBridge } from "./kernelsu"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

interface NativeProcess {
  stdout: { emit: (event: string, line: string) => void }
  stderr: { emit: (event: string, line: string) => void }
  emit: (event: string, value: number | Error) => void
}

function processAt(callback: string): NativeProcess {
  return (globalThis as unknown as Record<string, NativeProcess>)[callback]!
}

describe("native commands", () => {
  it("uses queued jobs, collects lines and preserves nonzero exits", async () => {
    const spawn = vi.fn()
    const exec = vi.fn()
    vi.stubGlobal("ksu", { spawn, exec })
    const bridge = createKernelSuBridge()
    const command = 'wrapper <<\'END\'\n{"value":"$(reboot)"}\nEND'
    const pending = bridge.exec(command)
    const [script, args, options, callback] = spawn.mock.calls[0] as string[]
    expect(script).toBe(`${command}\n`)
    expect(args).toBe("[]")
    expect(options).toBe("{}")
    expect(exec).not.toHaveBeenCalled()
    const native = processAt(callback!)
    native.stdout.emit("data", "warning")
    native.stdout.emit("data", '{"ok":false}')
    native.stderr.emit("data", "failed")
    native.emit("exit", 7)
    await expect(pending).resolves.toEqual({
      errno: 7,
      stdout: 'warning\n{"ok":false}',
      stderr: "failed",
    })
    native.emit("error", new Error("nonzero exit"))
    expect(processAt(callback!)).toBeUndefined()
  })

  it("releases failed jobs on hosts that omit the companion error", async () => {
    vi.useFakeTimers()
    const spawn = vi.fn()
    vi.stubGlobal("ksu", { spawn })
    const pending = createKernelSuBridge().exec("read")
    const callback = spawn.mock.calls[0]![3] as string
    processAt(callback).emit("exit", 1)
    await expect(pending).resolves.toEqual({ errno: 1, stdout: "", stderr: "" })
    await vi.runAllTimersAsync()
    expect(processAt(callback)).toBeUndefined()
  })

  it("keeps concurrent jobs separate and releases callbacks after errors", async () => {
    const spawn = vi.fn()
    vi.stubGlobal("ksu", { spawn })
    const bridge = createKernelSuBridge()
    const first = bridge.exec("first")
    const second = bridge.exec("second")
    const callbackA = spawn.mock.calls[0]![3] as string
    const callbackB = spawn.mock.calls[1]![3] as string
    expect(callbackA).not.toBe(callbackB)
    processAt(callbackB).stdout.emit("data", "second")
    processAt(callbackB).emit("exit", 0)
    processAt(callbackA).emit("error", new Error("stream failed"))
    await expect(first).rejects.toThrow("stream failed")
    await expect(second).resolves.toEqual({ errno: 0, stdout: "second", stderr: "" })
    expect(processAt(callbackA)).toBeUndefined()
    expect(processAt(callbackB)).toBeUndefined()
  })

  it("does not retry a failed launch through another transport", async () => {
    const exec = vi.fn()
    const spawn = vi.fn((_command: string, _args: string, _options: string, _callback: string) => {
      throw new Error("launch failed")
    })
    vi.stubGlobal("ksu", { spawn, exec })
    await expect(createKernelSuBridge().exec("save")).rejects.toThrow("launch failed")
    expect(exec).not.toHaveBeenCalled()
    expect(processAt(spawn.mock.calls[0]![3] as string)).toBeUndefined()
  })

  it("supports hosts that only expose exec", async () => {
    const exec = vi.fn((_command: string, _options: string, callback: string) => {
      const scope = window as unknown as Record<string, (...args: unknown[]) => void>
      scope[callback]!(0, "legacy", "")
    })
    vi.stubGlobal("ksu", { exec })
    await expect(createKernelSuBridge().exec("read")).resolves.toEqual({
      errno: 0,
      stdout: "legacy",
      stderr: "",
    })
    expect(exec.mock.calls[0]?.[0]).toBe("read")
  })
})

describe("hosting module", () => {
  it("reads the fixed module identity once per bridge", () => {
    const moduleInfo = vi.fn(() => JSON.stringify({ moduleDir: "/data/adb/modules/other" }))
    vi.stubGlobal("ksu", { moduleInfo })
    const bridge = createKernelSuBridge()
    expect(bridge.hostModule()).toEqual({ id: "other", dir: "/data/adb/modules/other" })
    expect(bridge.hostModule()).toEqual({ id: "other", dir: "/data/adb/modules/other" })
    expect(moduleInfo).toHaveBeenCalledTimes(1)
  })

  it("caches the fallback when the host cannot provide module information", () => {
    const moduleInfo = vi.fn(() => {
      throw new Error("unsupported")
    })
    vi.stubGlobal("ksu", { moduleInfo })
    const bridge = createKernelSuBridge()
    expect(bridge.hostModule()).toBeNull()
    expect(bridge.hostModule()).toBeNull()
    expect(moduleInfo).toHaveBeenCalledTimes(1)
  })
})

describe("native package metadata", () => {
  it("yields before the first call and between bounded batches", async () => {
    vi.useFakeTimers()
    const getPackagesInfo = vi.fn((json: string) =>
      JSON.stringify(
        (JSON.parse(json) as string[]).map((packageName) => ({
          packageName,
          appLabel: packageName,
          isSystem: false,
        })),
      ),
    )
    vi.stubGlobal("ksu", { getPackagesInfo })
    const names = Array.from({ length: 53 }, (_, index) => `com.app${index}`)
    const pending = createKernelSuBridge().packagesInfo(names)
    expect(getPackagesInfo).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect((await pending).map((entry) => entry.packageName)).toEqual(names)
    expect(
      getPackagesInfo.mock.calls.map(([json]) => (JSON.parse(json) as string[]).length),
    ).toEqual([24, 24, 5])
  })

  it("stops native calls when an observer cancels the query", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const getPackagesInfo = vi.fn(() => {
      controller.abort()
      return "[]"
    })
    vi.stubGlobal("ksu", { getPackagesInfo })
    const pending = createKernelSuBridge().packagesInfo(
      Array.from({ length: 100 }, (_, index) => `com.app${index}`),
      controller.signal,
    )
    await Promise.all([
      expect(pending).rejects.toMatchObject({ name: "AbortError" }),
      vi.runAllTimersAsync(),
    ])
    expect(getPackagesInfo).toHaveBeenCalledTimes(1)
  })

  it("keeps package-name fallbacks on hosts without the metadata API", async () => {
    vi.stubGlobal("ksu", {})
    await expect(createKernelSuBridge().packagesInfo(["com.unknown"])).resolves.toEqual([])
  })
})
