import { execFileSync } from "node:child_process";

function powershellJson(script: string): Record<string, unknown> | null {
  if (process.platform !== "win32") return null;
  try {
    return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function hostEnvironmentRecord(): Record<string, unknown> {
  const gpu = powershellJson("Get-CimInstance Win32_VideoController | Where-Object Name -Match 'NVIDIA|AMD|Intel' | Select-Object -First 1 Name,DriverVersion | ConvertTo-Json -Compress");
  const display = powershellJson("Add-Type -AssemblyName System.Windows.Forms; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; [pscustomobject]@{width=$b.Width;height=$b.Height} | ConvertTo-Json -Compress");
  let powerProfile: string | null = null;
  if (process.platform === "win32") {
    try {
      powerProfile = execFileSync("powercfg.exe", ["/getactivescheme"], { encoding: "utf8" }).trim();
    } catch {
      powerProfile = null;
    }
  }
  return { platform: process.platform, gpu, display, power_profile: powerProfile };
}

export function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}
