import { expect, test, type Page } from "@playwright/test";

const viewportWidths = [320, 360, 375, 390, 414, 580, 768, 851, 1024, 1440];

type Rectangle = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function expectInside(inner: Rectangle, outer: Rectangle, description: string) {
  // A pixel of tolerance allows fractional grid tracks and device rounding.
  expect(inner.left, `${description}: left edge`).toBeGreaterThanOrEqual(
    outer.left - 1,
  );
  expect(inner.right, `${description}: right edge`).toBeLessThanOrEqual(
    outer.right + 1,
  );
  expect(inner.top, `${description}: top edge`).toBeGreaterThanOrEqual(
    outer.top - 1,
  );
  expect(inner.bottom, `${description}: bottom edge`).toBeLessThanOrEqual(
    outer.bottom + 1,
  );
}

function expectSeparate(
  first: Rectangle,
  second: Rectangle,
  description: string,
) {
  const separated =
    first.right <= second.left + 1 ||
    second.right <= first.left + 1 ||
    first.bottom <= second.top + 1 ||
    second.bottom <= first.top + 1;
  expect(separated, description).toBe(true);
}

async function checkDateAndTimeLayout(page: Page, expectStacked: boolean) {
  const date = page.getByLabel("おでかけの日", { exact: true });
  const time = page.getByLabel("着きたい時刻", { exact: true });
  await expect(date).toBeVisible();
  await expect(time).toBeVisible();

  // Exercise the native controls, rather than only testing empty placeholders.
  await date.fill("2026-11-20");
  await time.fill("10:35");
  await expect(date).toHaveValue("2026-11-20");
  await expect(time).toHaveValue("10:35");

  const controls = await Promise.all(
    [date, time].map((control) =>
      control.evaluate((element) => {
        const input = element as HTMLInputElement;
        const group = input.closest(".input-group");
        const label = input.labels?.item(0);
        if (!group || !label)
          throw new Error("日付・時刻の入力欄が見つかりません");
        const rectangle = (target: Element) => {
          const bounds = target.getBoundingClientRect();
          return {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
          };
        };
        return {
          input: rectangle(input),
          group: rectangle(group),
          label: rectangle(label),
          clientWidth: input.clientWidth,
          scrollWidth: input.scrollWidth,
        };
      }),
    ),
  );

  for (const [index, control] of controls.entries()) {
    const name = index === 0 ? "日付" : "時刻";
    expectInside(control.input, control.group, `${name}入力は自身の欄に収まる`);
    expectInside(
      control.label,
      control.group,
      `${name}ラベルは自身の欄に収まる`,
    );
    expect(
      control.scrollWidth,
      `${name}入力の内容が横に切れない`,
    ).toBeLessThanOrEqual(control.clientWidth + 1);
  }
  expectSeparate(
    controls[0].group,
    controls[1].group,
    "日付と時刻の欄が重ならない",
  );
  expectSeparate(
    controls[0].input,
    controls[1].input,
    "ネイティブ入力が重ならない",
  );
  if (expectStacked) {
    expect(
      controls[1].group.top - controls[0].group.bottom,
      "狭い画面・大きな文字では日付と時刻が縦に並び、十分な間隔がある",
    ).toBeGreaterThanOrEqual(8);
  }

  const dateFrame = await date.locator("..").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
    };
  });
  expectInside(
    dateFrame,
    controls[0].group,
    "日付の外枠は隣の欄へはみ出さない",
  );
  expectInside(
    controls[0].input,
    dateFrame,
    "ネイティブ日付入力は外枠に収まる",
  );
  await date.focus();
  await expect(date).toBeFocused();
  await date.press("Tab");

  const timeLayout = await time.evaluate((element) => {
    const wrapper = element.closest(".time-input");
    const suffix = wrapper?.querySelector("span");
    if (!wrapper || !suffix) throw new Error("到着時刻の補足が見つかりません");
    const rectangle = (target: Element) => {
      const bounds = target.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
      };
    };
    return { wrapper: rectangle(wrapper), suffix: rectangle(suffix) };
  });
  expectInside(controls[1].input, timeLayout.wrapper, "時刻入力は枠内に収まる");
  expectInside(
    timeLayout.suffix,
    timeLayout.wrapper,
    "到着時刻の補足は枠内に収まる",
  );
  expectSeparate(
    controls[1].input,
    timeLayout.suffix,
    "時刻と補足が重ならない",
  );

  const documentWidth = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(
    documentWidth.content,
    "画面全体に横スクロールが生じない",
  ).toBeLessThanOrEqual(documentWidth.viewport + 1);
}

for (const width of viewportWidths) {
  test(`${width}px幅で日付・時刻欄が通常文字と大きな文字でも重ならない`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await test.step("通常の文字サイズ", async () => {
      await checkDateAndTimeLayout(page, width <= 580);
    });
    await page.getByRole("button", { name: "文字サイズ" }).click();
    await expect(
      page.getByRole("button", { name: "文字サイズ" }),
    ).toHaveAttribute("aria-pressed", "true");
    await test.step("大きな文字サイズ", async () => {
      await checkDateAndTimeLayout(page, true);
    });
  });
}
