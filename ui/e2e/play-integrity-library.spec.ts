import { expect, test } from "./fixtures"

test("restoring an unchanged saved configuration replaces an edited form draft", async ({
  page,
  open,
}) => {
  await open("/play-integrity/config")
  await page.getByRole("button", { name: "Preview changes", exact: true }).click()
  await page.getByRole("button", { name: "Apply configuration", exact: true }).click()
  await page.getByLabel("MODEL", { exact: true }).fill("Unsaved draft")
  await expect(page.getByText("Draft · not applied", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Restore previous configuration", exact: true }).click()
  await expect(page.getByLabel("MODEL", { exact: true })).toHaveValue("Pixel 9 Pro")
  await expect(page.getByText("Draft · not applied", { exact: true })).toHaveCount(0)
})

test("starts with common paired fields and keeps advanced values until explicitly synchronized", async ({
  page,
  open,
}) => {
  await open("/play-integrity/config")
  await expect(page.getByLabel("MODEL", { exact: true })).toBeVisible()
  await expect(page.getByLabel("ro.product.model", { exact: true })).toBeHidden()
  await page.getByRole("button", { name: "Edit matching properties", exact: true }).click()
  await expect(page.getByLabel("ro.product.model", { exact: true })).toBeVisible()
  await expect(page.getByText("spoofProvider", { exact: true })).toBeHidden()
  await page.getByLabel("MODEL", { exact: true }).fill("Draft model")
  await page.getByLabel("ro.product.model", { exact: true }).fill("Keep until asked")
  await page.getByRole("button", { name: "Fill matching properties", exact: true }).click()
  await expect(page.getByLabel("ro.product.model", { exact: true })).toHaveValue("Draft model")
  await page.getByRole("button", { name: "Advanced options", exact: true }).click()
  await page.getByRole("combobox", { name: "Legacy Provider compatibility", exact: true }).click()
  await expect(
    page.getByRole("option", { name: "Not set · legacy default on", exact: true }),
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Preview changes", exact: true }).click()
  await expect(page.getByRole("cell", { name: "ro.product.model", exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Diagnostics", exact: true }).click()
  await expect(page.getByRole("button", { name: "Apply configuration", exact: true })).toHaveCount(
    0,
  )
  await page.getByRole("link", { name: "Configuration", exact: true }).click()
  await expect(page.getByRole("cell", { name: "ro.product.model", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Dismiss preview", exact: true }).click()
  await page.reload()
  await expect(page.getByLabel("MODEL", { exact: true })).toHaveValue("Pixel 9 Pro")
})

test("saves named drafts and previews them without applying or enabling PIF", async ({
  page,
  open,
}) => {
  await open("/play-integrity/config")
  await page.getByRole("button", { name: "Disable PIF now", exact: true }).click()
  await page.getByLabel("MODEL", { exact: true }).fill("Saved draft")
  await page.getByRole("button", { name: "Saved configurations", exact: true }).click()
  await page.getByLabel("Configuration name", { exact: true }).fill("My device")
  await page.getByRole("button", { name: "Save draft as snapshot", exact: true }).click()
  await expect(
    page.getByText("Snapshot saved. The active configuration is unchanged."),
  ).toBeVisible()
  await page.getByLabel("MODEL", { exact: true }).fill("Another draft")
  await page.getByRole("button", { name: "Preview changes: My device", exact: true }).click()
  await expect(page.getByRole("cell", { name: "Saved draft", exact: true })).toBeVisible()
  await expect(page.getByLabel("MODEL", { exact: true })).toHaveValue("Another draft")
  await expect(
    page
      .getByText(/PIF is disabled\. Configuration and other toolbox features are retained\./)
      .first(),
  ).toBeVisible()
  await page.getByRole("button", { name: "Remove: My device", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByText("My device", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Remove: My device", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click()
  await expect(page.getByText("No saved configurations.", { exact: true })).toBeVisible()
})

test("records manual observations and clearly separates unobserved runtime values", async ({
  page,
  open,
}) => {
  await open("/play-integrity/diagnostics")
  await expect(page.getByText(/Target process values have not been observed/)).toBeVisible()
  await page.getByRole("button", { name: "Show field comparison", exact: true }).click()
  await expect(page.getByText("Current system reading", { exact: true }).first()).toBeVisible()
  await page.getByRole("button", { name: "Test history", exact: true }).click()
  await page.getByRole("button", { name: "Record a test", exact: true }).click()
  await page.getByLabel("Test app or source", { exact: true }).fill("Play Store")
  await page.getByLabel("App version (optional)", { exact: true }).fill("1")
  await page.getByRole("combobox", { name: "Basic", exact: true }).click()
  await page.getByRole("option", { name: "Passed (reported)", exact: true }).click()
  await page.getByRole("button", { name: "Save observation", exact: true }).click()
  await expect(page.getByText("Basic: Passed (reported)", { exact: false })).toBeVisible()
  await page.getByRole("button", { name: "Clear test history", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click()
  await expect(page.getByText("No recorded tests.", { exact: true })).toBeVisible()
})

test("shows dated sources without turning community reports into pass rules", async ({
  page,
  open,
}) => {
  await open("/play-integrity/license", { theme: "dark" })
  const selected = page.getByRole("link", { name: "Licenses", exact: true })
  await expect(selected).toBeInViewport()
  await expect(page.getByText("Last checked · 2026-10-24", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Community observations", exact: true }).click()
  await expect(
    page.getByText(/neither a universal Pixel ban nor an API 32–35 pass rule is established/),
  ).toBeVisible()
  await page.getByRole("button", { name: "Google requirements", exact: true }).click()
  await expect(
    page.getByText(/First shipped API is different from the running OS version/),
  ).toBeVisible()
})
