import { afterEach, describe, expect, it, vi } from "vitest"

import { registerFeatures } from "@/core/features"

import { applyLocale, i18n } from "./index"

afterEach(() => registerFeatures([]))

describe("locale loading", () => {
  it("shares pending loaders and applies only the latest selection", async () => {
    let finish!: (messages: { default: Record<string, unknown> }) => void
    const delayed = vi.fn(
      () =>
        new Promise<{ default: Record<string, unknown> }>((resolve) => {
          finish = resolve
        }),
    )
    registerFeatures([
      { id: "test", namespace: "test", icon: {}, order: 0, routes: [], messages: { ar: delayed } },
    ])
    const first = applyLocale("ar")
    const duplicate = applyLocale("ar")
    const latest = applyLocale("zh-CN")
    await latest
    await vi.waitFor(() => expect(delayed).toHaveBeenCalledTimes(1))
    finish({ default: { title: "loaded" } })
    await Promise.all([first, duplicate])
    expect(delayed).toHaveBeenCalledTimes(1)
    expect(i18n.global.locale.value).toBe("zh-CN")
    expect(document.documentElement.lang).toBe("zh-CN")
    expect(document.documentElement.dir).toBe("ltr")
  })
})
