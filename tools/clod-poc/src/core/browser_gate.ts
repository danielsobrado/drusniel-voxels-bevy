import { failLoud } from "./diagnostics.js";

interface UaClientHints {
  mobile?: boolean;
  brands?: { brand: string; version: string }[];
}

function clientHints(): UaClientHints | undefined {
  return (navigator as { userAgentData?: UaClientHints }).userAgentData;
}

export function isMobileDevice(): boolean {
  if (clientHints()?.mobile === true) return true;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPod|iPad|Windows Phone|IEMobile|Silk|Mobile/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 2;
}

export function isChromiumBrowser(): boolean {
  const brands = clientHints()?.brands;
  if (brands && brands.length > 0) {
    return brands.some((brand) => /Chromium|Google Chrome/i.test(brand.brand));
  }
  return /Chrome\//.test(navigator.userAgent);
}

export function browserGate(search = window.location.search): boolean {
  if (new URLSearchParams(search).get("nogate") === "1") return true;

  if (isMobileDevice()) {
    failLoud("Desktop browser required", [
      "The Phase-0 sanity path runs desktop-class WebGPU verification and rejects mobile/tablet browsers.",
      "Open this page from a desktop or laptop Chromium browser.",
    ]);
    return false;
  }
  if (!isChromiumBrowser()) {
    failLoud("Chromium browser required", [
      "The Phase-0 WebGPU harness is tested against Chromium WebGPU.",
      "Use Chrome, Edge, Brave, or another Chromium browser.",
    ]);
    return false;
  }
  if (!("gpu" in navigator) || !navigator.gpu) {
    failLoud("WebGPU unavailable", [
      "navigator.gpu is missing.",
      "Update Chromium, enable hardware acceleration, and verify chrome://gpu reports WebGPU support.",
    ]);
    return false;
  }
  return true;
}
