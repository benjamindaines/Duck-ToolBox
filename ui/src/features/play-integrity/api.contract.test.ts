// @vitest-environment node
import { existsSync } from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { CONTRACT, hasDuckd, installHost } from "@/core/testing/host"
import type { Host } from "@/core/testing/host"
import { integrityApi } from "./api"

const repository = path.resolve(import.meta.dirname, "../../../..")
const engine =
  process.env.PIF_ENGINE_BIN ?? path.join(repository, "target/pif-engine/debug/pif-engine")
if (process.env.DUCKD_REQUIRED === "1" && !existsSync(engine))
  throw new Error("contract tests require the independently built pif-engine")
let host: Host | undefined
afterEach(() => host?.dispose())
describe.skipIf(!hasDuckd || !existsSync(engine))(
  "Play Integrity adapter against the standalone engine",
  CONTRACT,
  () => {
    it("preserves the independent engine protocol across preview, apply and restore", async () => {
      host = installHost()
      const status = await integrityApi.status()
      expect(status.options.enabled).toBe(true)
      expect(status.verdict_verified).toBe(false)
      const before = await integrityApi.config()
      const preview = await integrityApi.preview(
        "MODEL=Contract\nEXTRA=preserved\nSECURITY_PATCH=2026-10-05",
        "prop",
        true,
      )
      expect((await integrityApi.config()).revision).toBe(before.revision)
      const saved = await integrityApi.apply(preview)
      expect(saved.config.entries.EXTRA).toBe("preserved")
      await expect(integrityApi.apply(preview)).rejects.toMatchObject({ code: "engine_error" })
      expect((await integrityApi.restore(saved.backup)).config.entries).toEqual({})
    })
    it("imports without changing the source and preserves conflict state", async () => {
      host = installHost({
        files: {
          "/data/adb/modules/playintegrityfix/module.prop": "id=playintegrityfix",
          "/data/local/tmp/custom.pif.prop": "MODEL=Imported\nEXTRA=keep",
        },
      })
      expect((await integrityApi.status()).conflicts).toEqual(["playintegrityfix"])
      const preview = await integrityApi.importPreview("/data/local/tmp/custom.pif.prop")
      expect(preview.entries.EXTRA).toBe("keep")
      expect((await integrityApi.config()).entries).toEqual({})
    })
    it("exposes the reviewed API and Provider rules without rewriting explicit choices", async () => {
      host = installHost()
      const empty = await integrityApi.preview("MODEL=New", "prop", true)
      expect(empty.entries.spoofProvider).toBe("0")
      expect(empty.entries.DEVICE_INITIAL_SDK_INT).toBeUndefined()
      expect(empty.entries["ro.board.first_api_level"]).toBeUndefined()
      expect(empty.warnings.some((warning) => warning.code === "missing_api")).toBe(true)
      const explicit = await integrityApi.preview(
        "MODEL=A\nro.product.model=B\nDEVICE_INITIAL_SDK_INT=36\nro.board.first_api_level=35\nspoofProvider=1",
        "prop",
        true,
      )
      expect(explicit.entries.DEVICE_INITIAL_SDK_INT).toBe("36")
      expect(explicit.entries["ro.board.first_api_level"]).toBe("35")
      expect(explicit.entries.spoofProvider).toBe("1")
      expect(explicit.warnings.some((warning) => warning.code === "mismatch")).toBe(true)
    })
  },
)
