import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function click(
  page: Page,
  x: number,
  y: number,
  modifiers: ('Shift' | 'Control')[] = [],
): Promise<void> {
  await page.locator('canvas').click({ position: { x, y }, modifiers });
}
async function color(page: Page, x: number, y: number): Promise<number[]> {
  return page.locator('canvas').evaluate(
    (canvas: HTMLCanvasElement, p) => {
      const scale = window.devicePixelRatio;
      return Array.from(
        canvas.getContext('2d')!.getImageData(p.x * scale, p.y * scale, 1, 1).data,
      ).slice(0, 3);
    },
    { x, y },
  );
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveAttribute('aria-busy', 'false');
});

test('loads real WASM and draws the three modifier node types on the canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await click(page, 150, 150);
  await click(page, 350, 150, ['Shift']);
  await click(page, 550, 250, ['Control']);
  await expect(page.locator('#status')).toContainText('3 points · Drawing');
  await expect.poll(() => color(page, 150, 150)).toEqual([211, 93, 83]);
  await expect.poll(() => color(page, 350, 150)).toEqual([66, 126, 170]);
  await expect.poll(() => color(page, 550, 250)).toEqual([188, 133, 46]);
  await page.keyboard.press('Meta+z');
  await expect(page.locator('#status')).toContainText('2 points');
  await page.keyboard.press('Meta+Shift+z');
  await expect(page.locator('#status')).toContainText('3 points');
  expect(errors).toEqual([]);
});

test('Shift-close, undo/redo, and C/S/T hover conversion', async ({ page }) => {
  await click(page, 150, 150, ['Shift']);
  await click(page, 350, 150, ['Shift']);
  await click(page, 150, 150, ['Shift']);
  await expect(page.locator('#status')).toContainText('Closed with cusp');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#status')).toContainText('Drawing');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('#status')).toContainText('Closed with cusp');
  const bounds = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(bounds.x + 150, bounds.y + 150);
  await page.keyboard.press('s');
  await expect.poll(() => color(page, 150, 150)).toEqual([66, 126, 170]);
  await page.keyboard.press('t');
  await expect.poll(() => color(page, 150, 150)).toEqual([188, 133, 46]);
  await page.keyboard.press('c');
  await expect.poll(() => color(page, 150, 150)).toEqual([211, 93, 83]);
});

test('node and handle tips use plain drag with grab/grabbing feedback', async ({ page }) => {
  await click(page, 150, 150);
  await click(page, 350, 150, ['Control']);
  await click(page, 550, 350);
  const bounds = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(bounds.x + 374, bounds.y + 150);
  await expect(page.locator('canvas')).toHaveCSS('cursor', 'grab');
  await page.mouse.down();
  await expect(page.locator('canvas')).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(bounds.x + 420, bounds.y + 180, { steps: 10 });
  await expect(page.locator('canvas')).toHaveCSS('cursor', 'grabbing');
  await page.mouse.up();
  await expect(page.locator('#status')).toContainText('1 manually adjusted');
  await page.keyboard.press('r');
  await expect(page.locator('#status')).not.toContainText('manually adjusted');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#status')).toContainText('1 manually adjusted');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#status')).not.toContainText('manually adjusted');
  await page.mouse.move(bounds.x + 550, bounds.y + 350);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 600, bounds.y + 400, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('Control+z');
  await expect.poll(() => color(page, 550, 350)).toEqual([211, 93, 83]);
});

test('handles show hover rings and retain selection after constrained drags', async ({ page }) => {
  await click(page, 150, 150);
  await click(page, 350, 150, ['Control']);
  await click(page, 550, 350);
  const canvas = page.locator('canvas');
  const bounds = (await canvas.boundingBox())!;
  const ringInk = async (x: number, y: number) =>
    canvas.evaluate(
      (el: HTMLCanvasElement, p) => {
        const ctx = el.getContext('2d')!;
        const ratio = devicePixelRatio;
        const size = Math.ceil(30 * ratio);
        const data = ctx.getImageData((p.x - 15) * ratio, (p.y - 15) * ratio, size, size).data;
        let alpha = 0;
        for (let dy = 0; dy < size; dy++)
          for (let dx = 0; dx < size; dx++) {
            const radius = Math.hypot(dx / ratio - 15, dy / ratio - 15);
            if (radius >= 11 && radius <= 14) alpha += data[(dy * size + dx) * 4 + 3];
          }
        return alpha;
      },
      { x, y },
    );
  await page.mouse.move(bounds.x + 20, bounds.y + 20);
  const before = await ringInk(374, 150);
  await page.mouse.move(bounds.x + 374, bounds.y + 150);
  await expect.poll(() => ringInk(374, 150)).toBeGreaterThan(before + 1000);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 420, bounds.y + 180, { steps: 5 });
  // The fixed C++ axis keeps the actual tip above the pointer; it stays active.
  const tipX = 350 + Math.hypot(70, 30);
  await page.screenshot({ path: 'test-results/bezigon-handle-active.png' });
  await page.mouse.up();
  await page.mouse.move(10, 10);
  await expect.poll(() => ringInk(tipX, 150)).toBeGreaterThan(before + 1000);
  await page.mouse.move(bounds.x + tipX, bounds.y + 150);
  await expect(canvas).toHaveCSS('cursor', 'grab');
});

test('selection persists and the SVG palette changes point types with undo/redo', async ({
  page,
}) => {
  const palette = page.getByRole('group', { name: 'Selected point type' });
  await expect(palette).toBeHidden();
  await click(page, 150, 150);
  await click(page, 350, 150);
  await click(page, 550, 350);
  await page.mouse.move(10, 10);
  await expect(palette).toBeVisible();
  await expect(palette.locator('#selected-point-label')).toHaveText('Point 3');
  await expect(palette.locator('svg')).toHaveCount(3);
  await expect(palette.getByRole('button', { name: 'Corner', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await palette.getByRole('button', { name: 'Smooth', exact: true }).click();
  await expect.poll(() => color(page, 550, 350)).toEqual([66, 126, 170]);
  await palette.getByRole('button', { name: 'Tangent', exact: true }).click();
  await expect.poll(() => color(page, 550, 350)).toEqual([188, 133, 46]);
  await page.keyboard.press('Control+z');
  await expect(palette.getByRole('button', { name: 'Smooth', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Control+Shift+z');
  await expect(palette.getByRole('button', { name: 'Tangent', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await click(page, 350, 150);
  await expect(palette.locator('#selected-point-label')).toHaveText('Point 2');
  await palette.getByRole('button', { name: 'Smooth', exact: true }).click();
  await expect.poll(() => color(page, 350, 150)).toEqual([66, 126, 170]);
  await page.screenshot({ path: 'test-results/bezigon-point-palette.png' });
  await page.locator('#clear').click();
  await expect(palette).toBeHidden();
  await page.locator('#undo').click();
  await expect(palette.locator('#selected-point-label')).toHaveText('Point 2');
});

test('the point palette fits a narrow canvas with enlarged text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await click(page, 100, 100);
  await click(page, 200, 200);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '125%';
  });
  const palette = page.getByRole('group', { name: 'Selected point type' });
  await expect(palette).toBeVisible();
  const canvasBounds = (await page.locator('canvas').boundingBox())!;
  for (const button of await palette.getByRole('button').all()) {
    const bounds = (await button.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(canvasBounds.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(canvasBounds.x + canvasBounds.width);
  }
  await page.screenshot({ path: 'test-results/bezigon-point-palette-mobile.png', fullPage: true });
});

test('example, visibility, finish, clear, and undo work through the UI', async ({ page }) => {
  await page.getByLabel('Load an example').selectOption('2');
  await expect(page.locator('#status')).toContainText('5 points · Closed path');
  await page.keyboard.press('d');
  await expect(page.locator('#handles')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await expect(page.locator('#empty')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#status')).toContainText('5 points');
  await page.locator('canvas').screenshot({ path: 'test-results/bezigon-canvas.png' });
  await page.keyboard.press('Escape');
  await click(page, 150, 150);
  await click(page, 350, 250, ['Shift']);
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toContainText('Finished open path');
  await click(page, 550, 350);
  await expect(page.locator('#status')).toContainText('1 point · Drawing');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#status')).toContainText('2 points · Finished open path');
});

test('layout fits a narrow viewport and canvas supports high DPI', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.locator('#examples').selectOption('5');
  await expect(page.locator('#status')).toContainText('Closed with cusp');
  await page.screenshot({ path: 'test-results/bezigon-mobile.png', fullPage: true });
});

test('quick click then drag keeps the point at its final mouse-up position', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const bounds = (await page.locator('canvas').boundingBox())!;
  const send = (
    type: 'mousePressed' | 'mouseReleased' | 'mouseMoved',
    x: number,
    y: number,
    buttons: number,
  ) =>
    cdp.send('Input.dispatchMouseEvent', {
      type,
      x: bounds.x + x,
      y: bounds.y + y,
      buttons,
      button: type === 'mouseMoved' ? 'none' : 'left',
      clickCount: type === 'mouseMoved' ? 0 : 1,
    });
  for (const deliverMove of [false, true]) {
    await page.keyboard.press('Escape');
    await send('mousePressed', 150, 150, 1);
    await send('mouseReleased', 150, 150, 0);
    await send('mouseMoved', 350, 150, 0);
    await send('mousePressed', 350, 150, 1);
    if (deliverMove) await send('mouseMoved', 400, 200, 1);
    await send('mouseReleased', 450, 250, 0);
    await expect(page.locator('#status')).toContainText('2 points · Drawing');
    await expect.poll(() => color(page, 450, 250)).toEqual([211, 93, 83]);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#status')).toContainText('1 point · Drawing');
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => color(page, 450, 250)).toEqual([211, 93, 83]);
  }
});

test('the palette resets only adjusted handles and supports undo/redo', async ({ page }) => {
  await click(page, 150, 150);
  await click(page, 350, 150, ['Control']);
  await click(page, 550, 350);
  const palette = page.getByRole('group', { name: 'Selected point type' });
  const reset = palette.getByRole('button', { name: 'Reset handles', exact: true });
  await expect(reset).toBeDisabled();
  const bounds = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(bounds.x + 374, bounds.y + 150);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 420, bounds.y + 180);
  await page.mouse.up();
  await expect(reset).toBeEnabled();
  await expect(page.locator('#status')).toContainText('1 manually adjusted');
  await reset.click();
  await expect(reset).toBeDisabled();
  await expect(page.locator('#status')).not.toContainText('manually adjusted');
  await expect(palette.locator('#selected-point-label')).toHaveText('Point 2');
  await page.locator('#undo').click();
  await expect(reset).toBeEnabled();
  await expect(page.locator('#status')).toContainText('1 manually adjusted');
  await page.locator('#redo').click();
  await expect(reset).toBeDisabled();
  await expect(page.locator('#status')).not.toContainText('manually adjusted');
});

test('pointer capture cleanup does not discard a point or leave drawing stuck', async ({
  page,
}) => {
  const canvas = page.locator('canvas');
  await canvas.evaluate((el) =>
    el.addEventListener('pointerdown', (event) => {
      (el as HTMLElement).dataset.testPointerId = String((event as PointerEvent).pointerId);
    }),
  );
  await click(page, 150, 150);
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 350, bounds.y + 150);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 400, bounds.y + 200);
  await canvas.evaluate((el) => {
    const pointerId = Number((el as HTMLElement).dataset.testPointerId);
    el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: pointerId + 1 }));
    el.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId }));
  });
  await expect(canvas).toHaveCSS('cursor', 'grabbing');
  await canvas.evaluate((el) =>
    el.releasePointerCapture(Number((el as HTMLElement).dataset.testPointerId)),
  );
  await page.mouse.move(bounds.x + 450, bounds.y + 250);
  await page.mouse.up();
  await expect(page.locator('#status')).toContainText('2 points · Drawing');
  await expect.poll(() => color(page, 400, 200)).toEqual([211, 93, 83]);
  await click(page, 650, 350);
  await expect(page.locator('#status')).toContainText('3 points · Drawing');
});
