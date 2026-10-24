// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest"

import { featureManifest, listFiles } from "@/core/duckd"
import type { Host, Server } from "@/core/testing/host"
import { DEVICE_PROPS, CONTRACT, hasDuckd, installHost } from "@/core/testing/host"

import { systemApi } from "./api"

let host: Host | undefined
let server: Server | undefined
afterEach(async () => {
  host?.dispose()
  await server?.close()
  server = undefined
})

describe.skipIf(!hasDuckd)("system API against the real duckd", CONTRACT, () => {
  it("lists the compiled features with their contracts", async () => {
    host = installHost()
    const manifest = await featureManifest()
    expect(manifest.features.map((feature) => feature.id)).toEqual([
      "rkp",
      "rkp-device",
      "tee-attestation",
      "device-ids",
      "tricky-store",
      "system",
    ])
  })

  it("summarizes the module and the device", async () => {
    host = installHost({ props: DEVICE_PROPS })
    const info = await systemApi.info()
    expect(info.module.id).toBe("duck-toolbox")
    expect(info.device.model).toBe("Pixel 9 Pro")
    expect(info.device.security_patch).toBe("2026-09-05")
  })

  it("lists outputs, files and the command log", async () => {
    host = installHost({ files: { "/sdcard/Download/keybox.xml": "<AndroidAttestation/>" } })
    await systemApi.info()
    expect((await systemApi.artifacts()).outputs).toEqual([])
    const files = await listFiles("/sdcard/Download", "xml")
    expect(files.entries.map((entry) => entry.name)).toEqual(["keybox.xml"])
    const log = await systemApi.log(5)
    expect(log.entries.map((entry) => entry.command)).toContain("system.info")
  })
})
