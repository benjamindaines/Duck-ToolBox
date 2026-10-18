import { mount } from "@vue/test-utils"
import { describe, expect, it, vi } from "vitest"

import AppRow from "./AppRow.vue"

vi.mock("../i18n", () => ({ useTrickyI18n: () => ({ t: (key: string) => key }) }))

describe("app row keyboard controls", () => {
  it("keeps the nested mode button from changing target selection", async () => {
    const row = mount(AppRow, {
      props: {
        packageName: "com.test",
        label: "Test",
        system: false,
        mode: "auto",
        customPolicy: false,
        tunable: true,
      },
    })
    await row.get("button").trigger("keydown", { key: "Enter" })
    expect(row.emitted("toggle")).toBeUndefined()
    await row.get("button").trigger("click")
    expect(row.emitted("tune")).toHaveLength(1)
    await row.trigger("keydown", { key: " " })
    expect(row.emitted("toggle")).toHaveLength(1)
    row.unmount()
  })
})
