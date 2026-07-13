interface AcceptanceSampleWindowPage {
  evaluate(callback: () => void): Promise<unknown>;
}

export async function resetAcceptanceSampleWindow(page: AcceptanceSampleWindowPage): Promise<void> {
  await page.evaluate(() => {
    const browserWindow = window as typeof window & {
      __drusnielPerf?: { reset(): void };
      __drusnielResetPhase0FrameStats?: () => void;
    };
    browserWindow.__drusnielPerf?.reset();
    browserWindow.__drusnielResetPhase0FrameStats?.();
  });
}
