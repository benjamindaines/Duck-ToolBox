import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query"
import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h } from "vue"
import { createI18n } from "vue-i18n"

import KeyboxCompatibilityDialog from "@/core/components/KeyboxCompatibilityDialog.vue"
import { notifySuccess } from "@/core/notify"

import type { KeyboxInstall, Status } from "./api"
import { trickyStoreApi } from "./api"
import { useKeyboxInstall } from "./keybox"
import { STATUS_KEY } from "./queries"

vi.mock("./i18n", () => ({ useTrickyI18n: () => ({ t: (key: string) => key }) }))
vi.mock("@/core/notify", () => ({ notifySuccess: vi.fn() }))

const installed: KeyboxInstall = {
  backend: "oh-my-keymint",
  target_path: "/data/misc/keystore/omk/keybox.xml",
  backup_path: "/data/misc/keystore/omk/keybox.xml.bak",
  size: 2048,
  source: "local",
  summary: { keyboxes: 1, has_ecdsa: true, has_rsa: false, chain_lengths: [3] },
}

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function setup(backend = "oh-my-keymint", bundled = false) {
  const status = vi
    .spyOn(trickyStoreApi, "status")
    .mockResolvedValue({ active: { backend } } as Status)
  const run = vi.fn<(input: string) => Promise<KeyboxInstall>>().mockResolvedValue(installed)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 15_000 } },
  })
  let install!: ReturnType<typeof useKeyboxInstall<string>>
  const wrapper = mount(
    defineComponent({
      setup() {
        install = useKeyboxInstall(run, { success: "ta.prompt_custom_key_set", bundled })
        return () => h(KeyboxCompatibilityDialog, { confirmation: install.compatibility })
      },
    }),
    {
      global: {
        plugins: [
          [VueQueryPlugin, { queryClient: client }],
          createI18n({ legacy: false, missingWarn: false, fallbackWarn: false }),
        ],
        stubs: { ConfirmDialog: true },
      },
    },
  )
  cleanups.push(() => {
    wrapper.unmount()
    client.clear()
  })
  return { wrapper, install, run, status, client }
}

describe("OMK external keybox compatibility warning", () => {
  it("waits for confirmation before installing and survives the dialog closing", async () => {
    const { wrapper, install, run } = setup()
    const pending = install.mutateAsync("keybox.xml")
    await flushPromises()
    const dialog = wrapper.findComponent({ name: "ConfirmDialog" })
    expect(dialog.props("open")).toBe(true)
    expect(dialog.props("description")).toBe("trickyStore.keybox.omkCompatibilityDescription")
    expect(run).not.toHaveBeenCalled()
    dialog.vm.$emit("confirm")
    dialog.vm.$emit("update:open", false)
    await expect(pending).resolves.toEqual(installed)
    expect(run).toHaveBeenCalledExactlyOnceWith("keybox.xml")
    expect(notifySuccess).toHaveBeenCalledOnce()
    expect(install.compatibility.open.value).toBe(false)
  })

  it("cancels without installing or reporting success and warns again on retry", async () => {
    const { wrapper, install, run } = setup()
    const pending = install.mutateAsync("first.xml")
    await flushPromises()
    wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:open", false)
    await expect(pending).resolves.toBeNull()
    expect(run).not.toHaveBeenCalled()
    expect(notifySuccess).not.toHaveBeenCalled()

    const retry = install.mutateAsync("second.xml")
    await flushPromises()
    expect(install.compatibility.open.value).toBe(true)
    install.compatibility.respond(true)
    await retry
    expect(run).toHaveBeenCalledExactlyOnceWith("second.xml")
  })

  it("checks the current backend even when another module's status is still cached", async () => {
    const { install, run, status, client } = setup()
    client.setQueryData(STATUS_KEY, { active: { backend: "tricky-store" } })
    const pending = install.mutateAsync("keybox.xml")
    await flushPromises()
    expect(status).toHaveBeenCalledOnce()
    expect(install.compatibility.open.value).toBe(true)
    expect(run).not.toHaveBeenCalled()
    install.compatibility.respond(false)
    await expect(pending).resolves.toBeNull()
  })

  it.each(["tricky-store", "tricky-store-legacy", "tee-simulator"])(
    "installs directly for %s",
    async (backend) => {
      const { install, run } = setup(backend)
      await install.mutateAsync("keybox.xml")
      expect(install.compatibility.open.value).toBe(false)
      expect(run).toHaveBeenCalledOnce()
    },
  )

  it("installs bundled dual-algorithm keyboxes without a warning or status lookup", async () => {
    const { install, run, status } = setup("oh-my-keymint", true)
    await install.mutateAsync("bundled")
    expect(status).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledOnce()
    expect(install.compatibility.open.value).toBe(false)
  })

  it("cancels pending confirmation when leaving the page", async () => {
    const { wrapper, install, run } = setup()
    const pending = install.mutateAsync("keybox.xml")
    await flushPromises()
    expect(install.compatibility.open.value).toBe(true)
    wrapper.unmount()
    await expect(pending).resolves.toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it("does not open a dialog or install if the page closes during detection", async () => {
    const { wrapper, install, run, status } = setup()
    let resolveStatus!: (value: Status) => void
    status.mockImplementationOnce(() => new Promise<Status>((resolve) => (resolveStatus = resolve)))
    const pending = install.mutateAsync("keybox.xml")
    await flushPromises()
    wrapper.unmount()
    resolveStatus({ active: { backend: "oh-my-keymint" } } as Status)
    await expect(pending).resolves.toBeNull()
    expect(install.compatibility.open.value).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
})
