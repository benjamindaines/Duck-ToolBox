import type { Page } from "@playwright/test"

import { expect, test } from "./fixtures"

test("does not repeat a failed automatic update check on navigation", async ({ page, open }) => {
  await page.addInitScript(() => {
    const scope = window as unknown as Record<string, unknown>
    let host: unknown
    scope.updateChecks = 0
    scope.moduleReads = 0
    Object.defineProperty(window, "ksu", {
      configurable: true,
      get: () => host,
      set: (value) => {
        const next = value as {
          exec: (shell: string, options: string, callback: string) => void
          moduleInfo: () => string
        }
        const exec = next.exec
        const moduleInfo = next.moduleInfo
        next.moduleInfo = () => {
          scope.moduleReads = Number(scope.moduleReads) + 1
          return moduleInfo()
        }
        next.exec = (shell, options, callback) => {
          if (!shell.includes("'system' 'update' 'check'")) return exec(shell, options, callback)
          scope.updateChecks = Number(scope.updateChecks) + 1
          const reply = scope[callback] as (code: number, stdout: string, stderr: string) => void
          setTimeout(
            () =>
              reply(
                1,
                JSON.stringify({
                  ok: false,
                  api: 1,
                  command: "system.update.check",
                  data: null,
                  error: { code: "download_failed", message: "offline" },
                }),
                "",
              ),
            20,
          )
        }
        host = next
      },
    })
  })
  await open("/")
  await expect(page.getByRole("button", { name: /Tricky Store/ })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { updateChecks: number }).updateChecks))
    .toBe(1)
  for (const name of [/RKP Workbench/, /TEE Attestation Extractor/, /Tricky Store/]) {
    await page.getByRole("button", { name }).click()
    await page.getByRole("button", { name: "Back", exact: true }).click()
    await expect(page.getByRole("button", { name: /Tricky Store/ })).toBeVisible()
  }
  await page.getByRole("button", { name: /Module & updates/ }).click()
  await expect(page.getByRole("button", { name: "Check for updates", exact: true })).toBeEnabled()
  expect(
    await page.evaluate(() => (window as unknown as { updateChecks: number }).updateChecks),
  ).toBe(1)
  expect(
    await page.evaluate(() => (window as unknown as { moduleReads: number }).moduleReads),
  ).toBe(1)
  await page.getByRole("button", { name: "Check for updates", exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { updateChecks: number }).updateChecks))
    .toBe(2)
})

async function addPackages(page: Page, system = false) {
  await page.evaluate((system) => {
    const scope = window as unknown as Record<string, unknown>
    const host = scope.ksu as {
      exec: (shell: string, options: string, callback: string) => void
      getPackagesInfo: (json: string) => string
    }
    const original = host.exec
    const packages = Array.from({ length: 1200 }, (_, index) => ({
      package_name: `com.test.app${String(index).padStart(4, "0")}`,
      system,
      selected: false,
      mode: "auto",
      tracked_system: false,
    }))
    scope.packageBatches = []
    host.getPackagesInfo = (json) => {
      const names = JSON.parse(json) as string[]
      ;(scope.packageBatches as number[]).push(names.length)
      return JSON.stringify(
        names.map((packageName) => ({ packageName, appLabel: packageName, isSystem: false })),
      )
    }
    host.exec = (shell, options, callback) => {
      if (!shell.includes("'tricky-store' 'status'")) return original(shell, options, callback)
      const intercepted = `large_list_${callback}`
      scope[intercepted] = (code: number, stdout: string, stderr: string) => {
        const envelope = JSON.parse(stdout)
        envelope.data.packages.push(...packages)
        ;(scope[callback] as (code: number, stdout: string, stderr: string) => void)(
          code,
          JSON.stringify(envelope),
          stderr,
        )
        delete scope[intercepted]
      }
      original(shell, options, intercepted)
    }
    performance.mark("large-list-start")
  }, system)
}

test("keeps a large target list bounded and bulk actions cover offscreen apps", async ({
  page,
  open,
}, testInfo) => {
  await open("/")
  await expect(page.getByRole("heading").first()).toBeVisible()
  await addPackages(page)
  await page.getByRole("button", { name: /Tricky Store/ }).click()
  await expect(page.getByText("4 selected")).toBeVisible()
  const initial = await page.evaluate(() => ({
    rows: document.querySelectorAll('main [role="checkbox"]').length,
    elapsed: performance.now() - performance.getEntriesByName("large-list-start")[0]!.startTime,
  }))
  await testInfo.attach("large-list-initial", {
    body: JSON.stringify(initial),
    contentType: "application/json",
  })
  expect(initial.rows).toBeLessThan(80)
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { packageBatches: number[] }).packageBatches.reduce(
          (total, size) => total + size,
          0,
        ),
      ),
    )
    .toBeGreaterThan(1200)
  expect(
    await page.evaluate(() =>
      Math.max(...(window as unknown as { packageBatches: number[] }).packageBatches),
    ),
  ).toBeLessThanOrEqual(24)

  await page.getByPlaceholder("Search").fill("com.test.app")
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Select all", exact: true }).click()
  await expect(page.getByText("1204 selected")).toBeVisible()
  await page.getByPlaceholder("Search").fill("com.test.app1199")
  await expect(page.getByRole("checkbox", { name: /com.test.app1199/ })).toHaveAttribute(
    "aria-checked",
    "true",
  )
  await page.getByPlaceholder("Search").fill("com.test.app")
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
    .toBeGreaterThan(10_000)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(page.getByRole("checkbox", { name: /com.test.app1199/ })).toBeAttached()
  expect(await page.locator('main [role="checkbox"]').count()).toBeLessThan(80)
  await page.getByPlaceholder("Search").fill("com.test.app0000")
  await expect(page.getByRole("checkbox", { name: /com.test.app0000/ })).toBeInViewport()
})

test("measures wrapped virtual rows after returning with enlarged text", async ({ page, open }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await open("/")
  await expect(page.getByRole("button", { name: /Tricky Store/ })).toBeVisible()
  await addPackages(page)
  await page.getByRole("button", { name: /Tricky Store/ }).click()
  await expect(page.getByText("4 selected")).toBeVisible()
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px"
  })
  const measured = () =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>("main [data-index]")]
        .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
        .map((row) => row.getBoundingClientRect())
      return (
        rows.length > 2 &&
        rows.some((row) => row.height > 96) &&
        rows.every((row, index) => index === 0 || row.top >= rows[index - 1]!.bottom - 1)
      )
    })
  await expect.poll(measured).toBe(true)
  await page.evaluate(() => {
    location.hash = "#/tricky-store/keybox"
  })
  await expect(page.getByRole("button", { name: "Add provider", exact: true })).toBeAttached()
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await expect.poll(measured).toBe(true)
  expect(await page.locator("main [data-index]").count()).toBeLessThan(80)
})

test("virtualizes system apps inside the dialog and retains offscreen selections", async ({
  page,
  open,
}) => {
  await open("/")
  await expect(page.getByRole("heading").first()).toBeVisible()
  await addPackages(page, true)
  await page.getByRole("button", { name: /Tricky Store/ }).click()
  await expect(page.getByText("4 selected")).toBeVisible()
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Add System App" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByPlaceholder("Search").fill("com.test.app")
  expect(await dialog.locator('[role="checkbox"]').count()).toBeLessThan(80)
  await dialog
    .locator("[data-index]")
    .first()
    .evaluate((row) => {
      const scroll = row.parentElement!.parentElement!
      scroll.scrollTop = scroll.scrollHeight
    })
  await dialog.getByRole("checkbox", { name: /com.test.app1199/ }).click()
  await dialog.getByRole("button", { name: "Save" }).click()
  await expect(dialog).toBeHidden()
  await page.getByPlaceholder("Search").fill("com.test.app1199")
  await expect(page.getByRole("checkbox", { name: /com.test.app1199/ })).toHaveAttribute(
    "aria-checked",
    "true",
  )
})
