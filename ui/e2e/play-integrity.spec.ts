import { expect, test } from "./fixtures"

test("previews arbitrary configuration before applying and exposes GPL notices", async ({
  page,
  open,
}) => {
  await open("/play-integrity/config")
  await expect(
    page.getByText("Based on Play Integrity Fork (GPLv3), modified.", { exact: true }),
  ).toBeVisible()
  await page
    .getByLabel("Configuration", { exact: true })
    .fill("MODEL=Example\nEXTRA=preserved\nSECURITY_PATCH=2026-10-05")
  await expect(page.getByRole("button", { name: "Apply configuration", exact: true })).toHaveCount(
    0,
  )
  await page.getByRole("button", { name: "Preview changes", exact: true }).click()
  await expect(page.getByRole("cell", { name: "EXTRA", exact: true })).toBeVisible()
  await expect(page.getByLabel(/Also apply this keystore patch policy/)).not.toBeChecked()
  await page.getByRole("button", { name: "Apply configuration", exact: true }).click()
  await expect(page.getByLabel("Configuration", { exact: true })).toHaveValue(/EXTRA=preserved/)
  await page.getByRole("button", { name: "GPLv3", exact: true }).click()
  await expect(page.getByText(/GNU GENERAL PUBLIC LICENSE/)).toBeVisible()
  await expect(
    page.getByRole("link", { name: "Corresponding source", exact: true }),
  ).toHaveAttribute("href", "./licenses/play-integrity-source.tar.gz")
})
test("generates a candidate without replacing the saved configuration", async ({ page, open }) => {
  await open("/play-integrity/generate")
  await page.getByRole("button", { name: "Generate fingerprint", exact: true }).click()
  await expect(page.getByText("Candidate ready for preview", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Apply configuration", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Dismiss preview", exact: true }).click()
  await page.getByRole("link", { name: "Configuration", exact: true }).click()
  await expect(page.getByLabel("Configuration", { exact: true })).not.toHaveValue(
    /MODEL=Pixel Canary/,
  )
})
test("supports mode changes, process diagnostics and Chinese notices", async ({ page, open }) => {
  await open("/play-integrity/compatibility")
  await page.getByRole("combobox", { name: "Engine mode", exact: true }).click()
  await page.getByRole("option", { name: "Scripts only", exact: true }).click()
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await page.getByRole("link", { name: "Status", exact: true }).click()
  await expect(page.getByText("Scripts-only mode", { exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Diagnostics", exact: true }).click()
  await page.getByRole("button", { name: "Read engine logs", exact: true }).click()
  await expect(page.getByText(/Injection initialized/)).toBeVisible()
})

test("edits launch API levels and custom fields through the shared form controls", async ({
  page,
  open,
}) => {
  await open("/play-integrity/config", { theme: "dark" })
  await page.getByRole("button", { name: "Edit fields", exact: true }).click()
  await page.getByLabel("DEVICE_INITIAL_SDK_INT", { exact: true }).fill("36")
  await page.getByLabel("ro.board.first_api_level", { exact: true }).fill("35")
  await page.getByLabel("Custom field or property", { exact: true }).fill("custom.flag")
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await page.getByLabel("custom.flag", { exact: true }).fill("retain")
  await page.getByRole("button", { name: "Preview changes", exact: true }).click()
  await expect(
    page.getByRole("cell", { name: "DEVICE_INITIAL_SDK_INT", exact: true }),
  ).toBeVisible()
  await expect(page.getByRole("cell", { name: "custom.flag", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Apply configuration", exact: true }).click()
  await page.getByRole("button", { name: "Raw text", exact: true }).click()
  await expect(page.getByLabel("Configuration", { exact: true })).toHaveValue(/custom.flag=retain/)
  await expect(page.getByLabel("Configuration", { exact: true })).toHaveValue(
    /DEVICE_INITIAL_SDK_INT=36/,
  )
})

test("shows the Chinese license footer", async ({ page, open }) => {
  await open("/play-integrity", { locale: "zh-CN" })
  await expect(
    page.getByText("基于 Play Integrity Fork（GPLv3），已修改。", { exact: true }),
  ).toBeVisible()
})

test("imports a file into a preview and rolls back a rejected patch update", async ({
  page,
  open,
}) => {
  await open("/play-integrity/config", { query: { "patch-fail": "1" } })
  await page.locator('input[aria-label="Import"]').setInputFiles({
    name: "custom.pif.prop",
    mimeType: "text/plain",
    buffer: Buffer.from("MODEL=Candidate\nSECURITY_PATCH=2026-10-05\nEXTRA=keep"),
  })
  await expect(page.getByRole("cell", { name: "EXTRA", exact: true })).toBeVisible()
  await page.getByLabel(/Also apply this keystore patch policy/).check()
  await page.getByRole("button", { name: "Apply configuration", exact: true }).click()
  await expect(page.getByText("Patch fixture rejected", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Configuration", { exact: true })).toHaveValue(/MODEL=Pixel 9 Pro/)
})
